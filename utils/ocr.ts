import { pdfjs } from "@/lib/pdf-init.client";

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
 * Sends a PDF file to the backend for OCR processing and receives an editable PDF.
 */
export async function processPdfWithBackend(file: File, onProgress?: (status: string) => void): Promise<File> {
    const formData = new FormData();
    formData.append('file', file);

    if (onProgress) onProgress('Uploading to Neural Backend...');

    const response = await fetch('/api/ocr', {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'OCR Processing failed');
    }

    if (onProgress) onProgress('Downloading Editable PDF...');

    const blob = await response.blob();
    return new File([blob], `editable_${file.name}`, { type: 'application/pdf' });
}

// Re-export old functions for compatibility only if needed, but they are deprecated
export async function pdfPageToImage() { console.warn('Deprecated: Use backend OCR'); }
export async function runOCR() { console.warn('Deprecated: Use backend OCR'); }
export async function createMultiPageEditablePdf() { console.warn('Deprecated: Use backend OCR'); }
