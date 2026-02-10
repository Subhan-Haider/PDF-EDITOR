'use client';

import { pdfjs } from 'react-pdf';

if (typeof window !== 'undefined') {
    const workerVersion = pdfjs.version;
    const workerUrl = `https://unpkg.com/pdfjs-dist@${workerVersion}/build/pdf.worker.min.mjs`;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    console.log('PDF.js Global Worker Initialized:', workerUrl);
}

export { pdfjs };
