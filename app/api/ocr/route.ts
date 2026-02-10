import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import Tesseract from "tesseract.js";
import * as pdfjs from "pdfjs-dist";
import { createCanvas } from "canvas";
import path from "path";

// Use standard font for PDF building
import { StandardFonts } from 'pdf-lib';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file");

        if (!file || !(file instanceof File)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        // 1. Load the PDF
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // We use a Uint8Array for pdfjs-dist
        const data = new Uint8Array(buffer);

        // Load document using pdfjs
        const standardFontDataPath = path.join(
            process.cwd(),
            "node_modules",
            "pdfjs-dist",
            "standard_fonts"
        );
        const pdf = await pdfjs.getDocument({
            data,
            standardFontDataUrl: `${standardFontDataPath}${path.sep}`,
            disableFontFace: true, // Avoid font loading issues in Node
            isEvalSupported: false,
            useSystemFonts: true,
        }).promise;

        // Create a new PDF document using pdf-lib (this will be our output)
        const newPdfDoc = await PDFDocument.create();

        // Iterate through each page
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // High res for OCR

            // Create canvas for rendering
            const canvas = createCanvas(viewport.width, viewport.height);
            const ctx = canvas.getContext("2d");

            // Render PDF page to canvas
            await page.render({
                canvasContext: ctx as any,
                viewport: viewport,
            }).promise;

            // Convert canvas to buffer (PNG)
            const imageBuffer = canvas.toBuffer("image/png");

            // 2. Run Tesseract OCR
            // We use 'eng' as default language
            const { data } = await Tesseract.recognize(imageBuffer, "eng", {
                logger: m => console.log(`[Page ${i}] ${m.status}: ${Math.floor(m.progress * 100)}%`)
            });
            const words = (data as any).words as Array<{
                text: string;
                bbox: { x0: number; y0: number; x1: number; y1: number };
            }> | undefined;

            // 3. Rebuild PDF Page
            // Add page to new PDF with original dimensions (scaled down to 1.0)
            // Note: Viewport was scale 2.0, so we divide by 2 for PDF dimensions
            const pdfPage = newPdfDoc.addPage([viewport.width / 2, viewport.height / 2]);
            const { width, height } = pdfPage.getSize();

            // Embed the image as the background (visual layer)
            const embeddedImage = await newPdfDoc.embedPng(imageBuffer);
            pdfPage.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });

            // Overlay transparent text (searchable/selectable layer)
            const font = await newPdfDoc.embedFont(StandardFonts.Helvetica);

            (words || []).forEach((word) => {
                // Tesseract bbox: x0, y0, x1, y1 (pixels from top-left)
                // PDF coords: x, y (points from bottom-left)
                // Scale factor: Tesseract ran on scale 2.0 image, PDF is scale 1.0 (72 DPI usually)

                const scale = 0.5; // Back to original PDF size

                // Calculate PDF coordinates
                // PDF Y = Page Height - (Word Y0 * scale) - (Word Height * scale)
                // We use the baseline or bottom of the word roughly
                const wordX = word.bbox.x0 * scale;
                const wordY = height - (word.bbox.y1 * scale);
                const wordHeight = (word.bbox.y1 - word.bbox.y0) * scale;
                const wordWidth = (word.bbox.x1 - word.bbox.x0) * scale;

                // Simple heuristic for font size
                const fontSize = wordHeight;

                pdfPage.drawText(word.text, {
                    x: wordX,
                    y: wordY,
                    size: fontSize,
                    font: font,
                    color: rgb(0, 0, 0),
                    opacity: 0, // Transparent text for searchability/selection
                });
            });
        }

        // 4. Return the new PDF
        const pdfBytes = await newPdfDoc.save();

        return new NextResponse(pdfBytes, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="ocr_processed_${file.name}"`,
            },
        });

    } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        console.error("Backend OCR/Processing Error:", details);
        return NextResponse.json(
            { error: "Failed to process PDF", details },
            { status: 500 }
        );
    }
}
