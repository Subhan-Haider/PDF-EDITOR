import { pdfjs } from "@/lib/pdf-init.client";
import Tesseract from "tesseract.js";
import { PDFDocument } from "pdf-lib";

/**
 * Detects if a PDF file is likely a scanned document (no text layer).
 */
export async function isScannedPdf(file: File): Promise<boolean> {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;

    // Check the first page for text
    const page = await pdf.getPage(1);
    const text = await page.getTextContent();

    return text.items.length === 0;
}

/**
 * Converts a specific PDF page to a PNG image (data URL).
 */
export async function pdfPageToImage(
    pdf: any,
    pageNumber: number
): Promise<{ dataUrl: string, width: number, height: number }> {
    const page = await pdf.getPage(pageNumber);
    // Quick Hack: Higher scale (3.0) for much better OCR accuracy
    const viewport = page.getViewport({ scale: 3.0 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Reliability Hack: Some browsers require the canvas to be in the DOM for full GPU acceleration
    canvas.style.display = 'none';
    document.body.appendChild(canvas);

    try {
        // Use a white background for the canvas to ensure clean OCR
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;
        return {
            dataUrl: canvas.toDataURL("image/png"),
            width: viewport.width,
            height: viewport.height
        };
    } finally {
        document.body.removeChild(canvas);
    }
}

interface OCRWord {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
}

interface OCRPage {
    text: string;
    words: OCRWord[];
    width: number;
    height: number;
    confidence: number;
}

/**
 * Runs OCR on an image and returns structural text data.
 */
export async function runOCR(image: string, onProgress?: (progress: number) => void): Promise<OCRPage> {
    const { data } = await Tesseract.recognize(image, "eng", {
        logger: m => {
            if (m.status === 'recognizing text' && onProgress) {
                onProgress(Math.floor(m.progress * 100));
            }
        },
    }) as any;

    const words: OCRWord[] = data.words.map((w: any) => ({
        text: w.text,
        x: w.bbox.x0,
        y: w.bbox.y0,
        width: w.bbox.x1 - w.bbox.x0,
        height: w.bbox.y1 - w.bbox.y0,
        confidence: w.confidence
    }));

    return {
        text: data.text,
        words,
        width: data.blocks?.[0]?.page?.width || 0,
        height: data.blocks?.[0]?.page?.height || 0,
        confidence: data.confidence
    };
}

/**
 * Rebuilds a complete multi-page editable PDF.
 */
export async function createMultiPageEditablePdf(
    pages: { structuralData: OCRPage, imageDataUrl: string }[]
): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont('Helvetica');

    for (const pageData of pages) {
        const { structuralData, imageDataUrl } = pageData;

        // Embed the background image
        const imageBytes = await fetch(imageDataUrl).then(res => res.arrayBuffer());
        const embeddedImage = await pdfDoc.embedPng(imageBytes);

        // Scale 3.0 was used for OCR, so divide by 3 for PDF coordinates
        const pdfWidth = embeddedImage.width / 3;
        const pdfHeight = embeddedImage.height / 3;
        const page = pdfDoc.addPage([pdfWidth, pdfHeight]);

        // Draw original background
        page.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: pdfWidth,
            height: pdfHeight,
        });

        // Overlay word layers for selection and structure preservation
        for (const word of structuralData.words) {
            if (word.text.trim()) {
                // PDF coordinates: (0,0) is bottom-left. OCR is top-left.
                const x = word.x / 3;
                const y = pdfHeight - (word.y / 3) - (word.height / 3);

                page.drawText(word.text, {
                    x,
                    y,
                    size: (word.height / 3) * 0.8,
                    font: font,
                    opacity: 0.1, // Near-invisible text layer for interactivity
                });
            }
        }
    }

    return await pdfDoc.save();
}
