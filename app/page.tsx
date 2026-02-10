'use client';

import dynamic from 'next/dynamic';

const PDFEditor = dynamic(() => import('@/components/PDFEditor'), {
  ssr: false,
});

import { pdfjs } from 'react-pdf';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

export default function Home() {
  return (
    <main className="min-h-screen w-full">
      <PDFEditor />
    </main>
  );
}

