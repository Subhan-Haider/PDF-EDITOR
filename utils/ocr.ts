import { pdfjs } from "@/lib/pdf-init.client";

/**
 * Detects if a PDF file is likely a scanned document (no text layer).
 */
export async function isScannedPdf(file: File): Promise<boolean> {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;

    const maxPagesToCheck = Math.min(pdf.numPages, 3);
    for (let pageIndex = 1; pageIndex <= maxPagesToCheck; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex);
        const text = await page.getTextContent();
        if (text.items.length > 0) {
            return false;
        }
    }

    return true;
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
        let message = 'OCR Processing failed';
        try {
            const errorData = await response.json();
            if (errorData && typeof errorData.error === 'string' && errorData.error.trim().length > 0) {
                message = errorData.error;
            } else if (errorData && typeof errorData.details === 'string' && errorData.details.trim().length > 0) {
                message = errorData.details;
            }
        } catch {
            try {
                const errorText = await response.text();
                if (errorText && errorText.trim().length > 0) {
                    message = errorText;
                }
            } catch {
                // keep default message
            }
        }
        throw new Error(`${message} (HTTP ${response.status})`);
    }

    if (onProgress) onProgress('Downloading Editable PDF...');

    const blob = await response.blob();
    return new File([blob], `editable_${file.name}`, { type: 'application/pdf' });
}

// Re-export old functions for compatibility only if needed, but they are deprecated
export async function pdfPageToImage() { console.warn('Deprecated: Use backend OCR'); }
export async function runOCR() { console.warn('Deprecated: Use backend OCR'); }
export async function createMultiPageEditablePdf() { console.warn('Deprecated: Use backend OCR'); }
