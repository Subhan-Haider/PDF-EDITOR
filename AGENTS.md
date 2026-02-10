# OCR Workflow For Scanned PDFs

Use pdf.js to detect text, convert pages to images, run OCR, and rebuild an editable PDF with `pdf-lib`.

## 1. Detect Scanned PDFs

```ts
import pdfjsLib from "pdfjs-dist";

export async function isScannedPdf(file: File): Promise<boolean> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();
  return textContent.items.length === 0;
}
```

`true` means image-only (scanned). `false` means the PDF already has text.

## 2. Convert PDF Page To Image

```ts
import pdfjsLib from "pdfjs-dist";

export async function pdfPageToImage(file: File, pageNum: number): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 3 });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  return canvas.toDataURL("image/png");
}
```

Tesseract works on images, not PDFs. Scale `>= 3` improves OCR accuracy.

## 3. Run OCR With Tesseract.js

```ts
import Tesseract from "tesseract.js";

export async function runOCR(imageDataUrl: string): Promise<string> {
  const { data } = await Tesseract.recognize(imageDataUrl, "eng", {
    logger: (m) => console.log(m),
  });
  return data.text;
}
```

## 4. Rebuild Editable PDF With pdf-lib

```ts
import { PDFDocument } from "pdf-lib";

export async function createEditablePdf(ocrText: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  page.drawText(ocrText, { x: 20, y: 800, size: 12 });
  return await pdfDoc.save();
}
```

This produces a real text layer. For exact layout, draw OCR text over the original page image.

## 5. Frontend Flow

```ts
const handleUpload = async (file: File) => {
  const scanned = await isScannedPdf(file);

  if (scanned) {
    alert("Scanned PDF detected. Performing OCR...");

    const image = await pdfPageToImage(file, 1);
    const text = await runOCR(image);
    const editablePdf = await createEditablePdf(text);

    openEditor(editablePdf);
  } else {
    openEditor(file);
  }
};
```

## 5.1 UI Copy (Scanned PDF Detected)

Scanned PDF detected.
Why the PDF isn't editable: scanned PDFs are image-only, so there is no text layer. Run OCR to create an editable text layer.

Backend OCR failed. We could not process this PDF, so we opened the original file instead.

## 6. Tips

Use `scale >= 3` for better OCR.
For multi-page PDFs, loop through pages, OCR each, and combine in `pdf-lib`.
Consider a Web Worker to avoid freezing the UI.
