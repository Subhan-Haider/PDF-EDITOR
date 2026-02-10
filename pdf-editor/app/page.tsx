'use client';

import dynamic from 'next/dynamic';

const PDFEditor = dynamic(() => import('@/components/PDFEditor'), {
  ssr: false,
});

export default function Home() {
  return <PDFEditor />;
}

