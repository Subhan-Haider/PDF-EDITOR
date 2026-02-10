'use client';

import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
    Upload,
    Download,
    Type,

    Highlighter,
    Eraser,
    ZoomIn,
    ZoomOut,
    RotateCw,
    FileText,
    Edit3,
    X,
    Check,
    Maximize,
    Bold,
    Italic,
    Undo2,
    Redo2,
    Loader2,
    AlertTriangle
} from 'lucide-react';
import { PDFDocument, rgb, StandardFonts, PDFName } from 'pdf-lib';
import { pdfjs } from '@/lib/pdf-init.client';
import { Document, Page } from 'react-pdf';
import { isScannedPdf, pdfPageToImage, runOCR, createMultiPageEditablePdf } from '@/utils/ocr';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Worker configuration is handled in @/lib/pdfjs

interface Tool {
    id: string;
    name: string;
    icon: React.ReactNode;
    description: string;
}

interface TextEdit {
    id: string;
    x: number;
    y: number;
    text: string;
    originalText: string;
    fontSize: number;
    isEditing: boolean;
    useMask: boolean;
    isModified: boolean;
    width?: number;
    height?: number;
    color?: string;
    fontFamily?: string;
    fontWeight?: string | number;
    fontStyle?: string;
}



export default function PDFEditor() {
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string>('');
    const [activeTool, setActiveTool] = useState<string>('select');
    const [zoom, setZoom] = useState<number>(100);
    const [rotation, setRotation] = useState<number>(0);
    const [numPages, setNumPages] = useState<number>(0);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [textEdits, setTextEdits] = useState<TextEdit[]>([]);
    const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [pdfInstance, setPdfInstance] = useState<any>(null);
    const [history, setHistory] = useState<TextEdit[][]>([]);
    const [redoStack, setRedoStack] = useState<TextEdit[][]>([]);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
    const [ocrStatus, setOcrStatus] = useState<string>('');
    const [ocrProgress, setOcrProgress] = useState<number>(0);
    const [isOcrRunning, setIsOcrRunning] = useState<boolean>(false);
    const [pendingScannedFile, setPendingScannedFile] = useState<File | null>(null);
    const isAnyEditing = textEdits.some(e => e.isEditing);

    // mount check
    React.useEffect(() => {
        console.log('PDFEditor Mounted - Ready for files');
    }, []);

    // Intelligence: Push current state to history before major changes
    const saveToHistory = (newEdits: TextEdit[]) => {
        setHistory(prev => [...prev, textEdits]);
        setRedoStack([]); // Clear redo stack on new action
        setTextEdits(newEdits);
    };

    const handleUndo = () => {
        if (history.length === 0 || isAnyEditing) return;
        const previous = history[history.length - 1];
        setRedoStack(prev => [...prev, textEdits]);
        setHistory(prev => prev.slice(0, -1));
        setTextEdits(previous);
    };

    const handleRedo = () => {
        if (redoStack.length === 0 || isAnyEditing) return;
        const next = redoStack[redoStack.length - 1];
        setHistory(prev => [...prev, textEdits]);
        setRedoStack(prev => prev.slice(0, -1));
        setTextEdits(next);
    };

    // Global Shortcut Listener
    React.useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    if (e.shiftKey) {
                        handleRedo();
                    } else {
                        handleUndo();
                    }
                    e.preventDefault();
                } else if (e.key === 'y') {
                    handleRedo();
                    e.preventDefault();
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [textEdits, history, redoStack, isAnyEditing]);

    const tools: Tool[] = [
        { id: 'select', name: 'Select', icon: <Type size={20} />, description: 'Edit detected text' },
        { id: 'region', name: 'Region Edit', icon: <Eraser size={20} />, description: 'Drag to replace scanned text' },
        { id: 'text', name: 'Add Text', icon: <Edit3 size={20} />, description: 'Place text anywhere' },
        { id: 'highlight', name: 'Highlight', icon: <Highlighter size={20} />, description: 'Highlight area' },
    ];

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.type === 'application/pdf') {
            try {
                const scanned = await isScannedPdf(file);

                if (scanned) {
                    setPendingScannedFile(file);
                } else {
                    setPdfFile(file);
                    setPdfUrl(URL.createObjectURL(file));
                    setTextEdits([]);
                    setZoom(100);
                }
            } catch (error) {
                console.error('Initial analysis failed:', error);
                setPdfFile(file);
                setPdfUrl(URL.createObjectURL(file));
                setTextEdits([]);
                setZoom(100);
            }
        } else if (file.type.startsWith('image/')) {
            // Intelligence: Image to PDF Conversion
            try {
                const pdfDoc = await PDFDocument.create();
                const imageBytes = await file.arrayBuffer();
                let embeddedImage;

                if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
                    embeddedImage = await pdfDoc.embedJpg(imageBytes);
                } else if (file.type === 'image/png') {
                    embeddedImage = await pdfDoc.embedPng(imageBytes);
                } else {
                    alert('Unsupported image format. Please use PNG or JPG.');
                    return;
                }

                const { width, height } = embeddedImage.scale(1);
                const page = pdfDoc.addPage([width, height]);
                page.drawImage(embeddedImage, { x: 0, y: 0, width, height });

                const pdfBytes = await pdfDoc.save();
                const newFile = new File([pdfBytes as any], file.name.replace(/\.[^/.]+$/, "") + ".pdf", { type: 'application/pdf' });

                setPdfFile(newFile);
                setPdfUrl(URL.createObjectURL(newFile));
                setTextEdits([]);
                setZoom(100);
            } catch (error) {
                console.error('Image conversion failed:', error);
                alert('Failed to process image.');
            }
        }
    };

    const onDocumentLoadSuccess = (pdf: any) => {
        setNumPages(pdf.numPages);
        setCurrentPage(1);
        setPdfInstance(pdf);
    };

    const onPageLoadSuccess = (page: any) => {
        if (containerRef.current) {
            const containerWidth = containerRef.current.clientWidth - 48;
            const pageWidth = page.width;

            // Intelligence: If the page is too big OR too small, fit it to the width
            // but don't exceed 110% zoom automatically
            const fitScale = Math.floor((containerWidth / pageWidth) * 100);

            // If the user hasn't manually zoomed yet, apply fit
            if (zoom === 100) {
                setZoom(Math.max(30, Math.min(fitScale, 110)));
            }
        }

    };

    const processScannedFile = async () => {
        if (!pendingScannedFile) return;

        const file = pendingScannedFile;
        setPendingScannedFile(null);
        setIsOcrRunning(true);
        setOcrStatus('Initializing Neural OCR Engine...');
        setOcrProgress(5);

        try {
            const data = await file.arrayBuffer();
            const tempPdf = await pdfjs.getDocument({ data }).promise;
            const totalPages = tempPdf.numPages;
            const processedPages = [];

            for (let i = 1; i <= totalPages; i++) {
                setOcrStatus(`Processing Page ${i} of ${totalPages}...`);
                setOcrProgress((i - 1) / totalPages * 100);

                const imageResult = await pdfPageToImage(tempPdf, i);

                const structuralData = await runOCR(imageResult.dataUrl, (p) => {
                    const baseProgress = ((i - 1) / totalPages) * 100;
                    const pageWeight = (1 / totalPages) * 100;
                    setOcrProgress(baseProgress + (p * pageWeight * 0.8));
                });

                processedPages.push({
                    structuralData,
                    imageDataUrl: imageResult.dataUrl
                });
            }

            const lowConfidencePages = processedPages
                .map((p, idx) => p.structuralData.confidence < 70 ? idx + 1 : null)
                .filter(p => p !== null);

            if (lowConfidencePages.length > 0) {
                alert(`Note: Neural OCR confidence is low on pages: ${lowConfidencePages.join(', ')}. Some text structure might be distorted.`);
            }

            setOcrStatus('Synthesizing Neural PDF Layers...');
            setOcrProgress(95);
            const editablePdfBytes = await createMultiPageEditablePdf(processedPages);
            const editableFile = new File([editablePdfBytes as BlobPart], file.name.replace('.pdf', '') + '_editable.pdf', { type: 'application/pdf' });

            setPdfFile(editableFile);
            setPdfUrl(URL.createObjectURL(editableFile));
            setTextEdits([]);
            setZoom(100);
        } catch (error) {
            console.error('OCR failed:', error);
            alert('Cloud-less OCR failed. Opening original file.');
            setPdfFile(file);
            setPdfUrl(URL.createObjectURL(file));
        } finally {
            setIsOcrRunning(false);
            setOcrStatus('');
            setOcrProgress(0);
        }
    };

    // Robust Auto-Scan: Watch for page changes and scan automatically
    React.useEffect(() => {
        if (pdfInstance && !isScanning) {
            const isCurrentPageScanned = textEdits.some(edit => edit.id.startsWith(`scan-${currentPage}-`));
            if (!isCurrentPageScanned) {
                scanCurrentPage();
            }
        }
    }, [currentPage, pdfInstance]);

    const scanCurrentPage = async () => {
        if (!pdfInstance || isScanning) return;

        setIsScanning(true);
        try {
            const page = await pdfInstance.getPage(currentPage);
            const viewport = page.getViewport({ scale: 1 });
            const textContent = await page.getTextContent();

            const newEdits: TextEdit[] = textContent.items.map((item: any, index: number) => {
                const [, , , scaleY, tx, ty] = item.transform;
                const style = textContent.styles[item.fontName];

                return {
                    id: `scan-${currentPage}-${index}`,
                    x: tx,
                    y: viewport.height - ty - (Math.abs(scaleY) || 12),
                    text: item.str,
                    originalText: item.str,
                    fontSize: Math.abs(scaleY) || 12,
                    isEditing: false,
                    useMask: true,
                    isModified: false,
                    width: item.width,
                    height: item.height,
                    color: '#000000', // Default to black, PDF.js color extraction is complex
                    fontFamily: style?.fontFamily || 'Helvetica'
                };
            }).filter((item: any) => item.text.trim().length > 0);

            if (newEdits.length > 0) {
                setTextEdits(prev => {
                    const filtered = prev.filter(edit => !edit.id.startsWith(`scan-${currentPage}-`));
                    return [...filtered, ...newEdits];
                });
            }
            setActiveTool('select');
        } catch (error) {
            console.error('Scan failed:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
    const [dragEnd, setDragEnd] = useState<{ x: number, y: number } | null>(null);

    const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        // Strict Focus Lock: Don't allow new drags or clicks if something is currently being edited
        if (textEdits.some(e => e.isEditing)) return;

        if ((activeTool === 'region' || activeTool === 'select') && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const clickX = (event.clientX - rect.left) / (zoom / 100);
            const clickY = (event.clientY - rect.top) / (zoom / 100);

            // Intelligence: If clicking an existing edit in select mode, start dragging
            if (activeTool === 'select') {
                const clickedEdit = [...textEdits].reverse().find(edit => {
                    const width = edit.width || (edit.text.length * (edit.fontSize * 0.6));
                    const height = edit.fontSize * 1.2;
                    return clickX >= edit.x && clickX <= edit.x + width &&
                        clickY >= edit.y && clickY <= edit.y + height;
                });

                if (clickedEdit && !clickedEdit.isEditing) {
                    setDraggingId(clickedEdit.id);
                    setDragOffset({
                        x: clickX - clickedEdit.x,
                        y: clickY - clickedEdit.y
                    });
                    return;
                }
            }

            setDragStart({ x: clickX, y: clickY });
        }

        // If not dragging, still try standard click
        if (activeTool === 'text') {
            handleCanvasClick(event);
        }
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const currentX = (event.clientX - rect.left) / (zoom / 100);
        const currentY = (event.clientY - rect.top) / (zoom / 100);

        if (draggingId) {
            setTextEdits(prev => prev.map(edit =>
                edit.id === draggingId
                    ? { ...edit, x: currentX - dragOffset.x, y: currentY - dragOffset.y, isModified: true }
                    : edit
            ));
        } else if (dragStart && (activeTool === 'region' || activeTool === 'select')) {
            setDragEnd({ x: currentX, y: currentY });
        }
    };

    const handleMouseUp = () => {
        if (draggingId) {
            saveToHistory(textEdits);
            setDraggingId(null);
        } else if (dragStart && dragEnd && (activeTool === 'region' || activeTool === 'select')) {
            const x = Math.min(dragStart.x, dragEnd.x);
            const y = Math.min(dragStart.y, dragEnd.y);
            const width = Math.abs(dragStart.x - dragEnd.x);
            const height = Math.abs(dragStart.y - dragEnd.y);

            if (width > 5 && height > 5) {
                // ... same logic for creating new text edit ...
                const lastEdit = selectedTextId ? textEdits.find(e => e.id === selectedTextId) : textEdits[textEdits.length - 1];

                const newTextEdit: TextEdit = {
                    id: Date.now().toString(),
                    x: x,
                    y: y,
                    text: 'New Text',
                    originalText: '',
                    fontSize: lastEdit?.fontSize || Math.max(12, Math.min(height * 0.7, 24)),
                    color: lastEdit?.color || '#000000',
                    fontFamily: lastEdit?.fontFamily || 'Helvetica',
                    isEditing: true,
                    useMask: true,
                    isModified: true,
                    width: width,
                    height: height
                };

                const updatedEdits = textEdits.map((e: TextEdit) => ({ ...e, isEditing: false })).concat(newTextEdit);
                saveToHistory(updatedEdits);
                setSelectedTextId(newTextEdit.id);
            }
        }
        setDragStart(null);
        setDragEnd(null);
    };

    const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (activeTool === 'text' && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            // Intelligence: Inherit style from the last selected/edited item
            const lastEdit = selectedTextId ? textEdits.find(e => e.id === selectedTextId) : textEdits[textEdits.length - 1];

            const newTextEdit: TextEdit = {
                id: Date.now().toString(),
                x: x / (zoom / 100),
                y: y / (zoom / 100),
                text: 'New Text',
                originalText: '',
                fontSize: lastEdit?.fontSize || 16,
                color: lastEdit?.color || '#000000',
                fontFamily: lastEdit?.fontFamily || 'Helvetica',
                isEditing: true,
                useMask: true,
                isModified: true,
            };

            // Ensure only one is editing
            const updatedEdits = textEdits.map((e: TextEdit) => ({ ...e, isEditing: false })).concat(newTextEdit);
            saveToHistory(updatedEdits);
            setSelectedTextId(newTextEdit.id);
        }
    };

    const handleTextChange = (id: string, newText: string) => {
        setTextEdits(textEdits.map(edit =>
            edit.id === id ? { ...edit, text: newText, isModified: newText !== edit.originalText } : edit
        ));
    };

    const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
        if (e.key === 'Enter') {
            handleTextEditComplete(id);
        }
        if (e.key === 'Escape') {
            handleTextEditComplete(id);
        }
    };

    const handleTextEditComplete = (id: string) => {
        setTextEdits(textEdits.map(edit =>
            edit.id === id ? { ...edit, isEditing: false } : edit
        ));
        setSelectedTextId(null);
    };



    const clearAllEdits = () => {
        if (window.confirm('Are you sure you want to clear all edits on this page?')) {
            saveToHistory([]);
            setSelectedTextId(null);
        }
    };

    const handleTextEditStart = (id: string) => {
        // Strict Focus Lock: If someone is editing, don't allow switching until they press DONE
        if (textEdits.some(e => e.isEditing && e.id !== id)) return;

        setTextEdits(textEdits.map(edit => ({
            ...edit,
            isEditing: edit.id === id
        })));
        setSelectedTextId(id);
        if (activeTool !== 'select') {
            setActiveTool('select');
        }
    };

    const handleDownload = async () => {
        if (!pdfFile) return;

        try {
            const existingPdfBytes = await pdfFile.arrayBuffer();
            const pdfDoc = await PDFDocument.load(existingPdfBytes);
            const pages = pdfDoc.getPages();
            const page = pages[currentPage - 1];

            // Intelligence: Clear original annotations (links, underscores, etc.) from this page 
            // to prevent "Ghost Lines" from showing on top of new edits.
            try {
                page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([]));
            } catch (e) {
                console.warn('Could not clear annotations:', e);
            }

            // Intelligence: Support multiple standard fonts including Bold/Italic variants
            const fontSans = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const fontSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            const fontSansItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
            const fontSansBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

            const fontSerif = await pdfDoc.embedFont(StandardFonts.TimesRoman);
            const fontSerifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
            const fontSerifItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
            const fontSerifBoldItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);

            const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
            const fontMonoBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
            const fontMonoItalic = await pdfDoc.embedFont(StandardFonts.CourierOblique);
            const fontMonoBoldItalic = await pdfDoc.embedFont(StandardFonts.CourierBoldOblique);

            // Add text edits to PDF
            textEdits.forEach((edit) => {
                if (!edit.isEditing && (edit.isModified || edit.originalText === '')) {
                    // Decide which font to use
                    const isBold = edit.fontWeight === 'bold';
                    const isItalic = edit.fontStyle === 'italic';

                    let font = fontSans;
                    const fontLower = (edit.fontFamily || '').toLowerCase();

                    if (fontLower.includes('serif') || fontLower.includes('times')) {
                        if (isBold && isItalic) font = fontSerifBoldItalic;
                        else if (isBold) font = fontSerifBold;
                        else if (isItalic) font = fontSerifItalic;
                        else font = fontSerif;
                    } else if (fontLower.includes('mono') || fontLower.includes('courier')) {
                        if (isBold && isItalic) font = fontMonoBoldItalic;
                        else if (isBold) font = fontMonoBold;
                        else if (isItalic) font = fontMonoItalic;
                        else font = fontMono;
                    } else {
                        if (isBold && isItalic) font = fontSansBoldItalic;
                        else if (isBold) font = fontSansBold;
                        else if (isItalic) font = fontSansItalic;
                        else font = fontSans;
                    }

                    // PDF coordinates are from bottom-left. Adjust baseline for top-aligned edit.y
                    const pdfY = page.getHeight() - edit.y - (edit.fontSize * 0.85);

                    if (edit.useMask && edit.isModified) {
                        // Extra-Wide Mask: Increased padding to ensure 100% coverage of original text
                        const maskPaddingX = 12;
                        const maskWidth = (edit.width || (edit.text.length * (edit.fontSize * 0.6))) + maskPaddingX;
                        // Precision Masking: Height and Y offset specifically tuned to cover 
                        // all original character descenders and any potential PDF underlines.
                        const maskHeight = edit.fontSize * 1.4;

                        page.drawRectangle({
                            x: edit.x - (maskPaddingX / 2),
                            y: pdfY - (edit.fontSize * 0.35), // Start deep enough to kill all original underlines
                            width: maskWidth,
                            height: maskHeight,
                            color: rgb(1, 1, 1),
                        });
                    }

                    if (edit.text.length > 0) {
                        const editColor = edit.color || '#000000';
                        const match = editColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
                        const r = match ? parseInt(match[1], 16) / 255 : 0;
                        const g = match ? parseInt(match[2], 16) / 255 : 0;
                        const b = match ? parseInt(match[3], 16) / 255 : 0;

                        page.drawText(edit.text, {
                            x: edit.x,
                            y: pdfY,
                            size: edit.fontSize,
                            font: font,
                            color: rgb(r, g, b),
                        });
                    }
                }
            });

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'edited-document.pdf';
            link.click();
        } catch (error) {
            console.error('Error saving PDF:', error);
        }
    };

    const handleZoomIn = () => setZoom((prev) => Math.min(prev + 10, 200));
    const handleZoomOut = () => setZoom((prev) => Math.max(prev - 10, 50));
    const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

    return (
        <div className="min-h-screen bg-transparent">
            {/* Header */}
            <motion.header
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="glass-strong border-b border-white/10 sticky top-0 z-50"
            >
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-neural flex items-center justify-center">
                                <FileText className="text-white" size={24} />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold bg-gradient-to-r from-neural-400 to-neural-600 bg-clip-text text-transparent">
                                    PDF Editor Pro
                                </h1>
                                <p className="text-xs text-gray-400">Professional PDF Editing Suite</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => fileInputRef.current?.click()}
                                className="glass px-6 py-2.5 rounded-xl flex items-center gap-2 hover:bg-white/10 transition-all"
                            >
                                <Upload size={18} />
                                <span className="font-medium">Upload PDF</span>
                            </motion.button>

                            {pdfFile && (
                                <div className="flex items-center gap-2 mr-4 border-r border-white/10 pr-4">
                                    <button
                                        onClick={handleUndo}
                                        disabled={history.length === 0 || isAnyEditing}
                                        className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 transition-all text-white"
                                        title="Undo (Ctrl+Z)"
                                    >
                                        <Undo2 size={20} />
                                    </button>
                                    <button
                                        onClick={handleRedo}
                                        disabled={redoStack.length === 0 || isAnyEditing}
                                        className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 transition-all text-white"
                                        title="Redo (Ctrl+Y)"
                                    >
                                        <Redo2 size={20} />
                                    </button>
                                </div>
                            )}

                            {pdfFile && (
                                <motion.button
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={handleDownload}
                                    className="bg-gradient-neural px-6 py-2.5 rounded-xl flex items-center gap-2 hover:shadow-lg hover:shadow-neural-500/50 transition-all text-white"
                                >
                                    <Download size={18} />
                                    <span className="font-medium">Download</span>
                                </motion.button>
                            )}
                        </div>
                    </div>
                </div>
            </motion.header>

            <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={handleFileUpload}
                className="hidden"
            />

            <div className="max-w-7xl mx-auto px-6 py-8">
                <div className="grid grid-cols-12 gap-6">
                    {/* Sidebar - Tools */}
                    <motion.aside
                        initial={{ x: -100, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="col-span-3"
                    >
                        <div className="glass-strong rounded-2xl p-6 sticky top-24">
                            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-neural-500 animate-pulse"></div>
                                Tools
                            </h2>

                            <div className="space-y-2">
                                {pdfFile && (
                                    <div className="p-4 rounded-xl bg-neural-500/10 border-2 border-neural-500/20 mb-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-2 h-2 rounded-full bg-neural-500 animate-pulse" />
                                            <span className="text-xs font-bold uppercase tracking-wider text-neural-400">Smart Auto-Scan</span>
                                        </div>
                                        <p className="text-[10px] leading-relaxed text-gray-400">
                                            Text layers are automatically detected as you browse. {isScanning ? 'Currently analyzing page...' : 'Page is ready for editing.'}
                                        </p>
                                    </div>
                                )}

                                {textEdits.length > 0 && (
                                    <motion.button
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        onClick={clearAllEdits}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-red-400 hover:bg-red-500/10 transition-all mb-4 border border-red-500/20"
                                    >
                                        <X size={16} />
                                        <span className="text-xs font-semibold">Clear All Edits</span>
                                    </motion.button>
                                )}

                                {tools.map((tool) => (
                                    <motion.button
                                        key={tool.id}
                                        whileHover={{ x: 4, scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => {
                                            setActiveTool(tool.id);
                                        }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all border ${activeTool === tool.id
                                            ? 'bg-gradient-neural text-white shadow-lg shadow-neural-500/30 border-neural-400'
                                            : 'glass hover:bg-white/10 border-white/10'
                                            }`}
                                    >
                                        {tool.icon}
                                        <div className="text-left">
                                            <div className="font-medium text-sm">{tool.name}</div>
                                            <div className="text-xs opacity-70">{tool.description}</div>
                                        </div>
                                    </motion.button>
                                ))}
                            </div>

                            <div className="mt-6 pt-6 border-t border-white/10">
                                <h3 className="text-sm font-semibold mb-3">View Controls</h3>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-gray-400">Zoom</span>
                                        <div className="flex items-center gap-2">
                                            <motion.button
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.9 }}
                                                onClick={handleZoomOut}
                                                className="glass p-2 rounded-lg hover:bg-white/10"
                                            >
                                                <ZoomOut size={16} />
                                            </motion.button>
                                            <span className="text-sm font-medium w-12 text-center">{zoom}%</span>
                                            <motion.button
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.9 }}
                                                onClick={handleZoomIn}
                                                className="glass p-2 rounded-lg hover:bg-white/10"
                                            >
                                                <ZoomIn size={16} />
                                            </motion.button>
                                            <motion.button
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.9 }}
                                                onClick={() => {
                                                    if (pdfInstance && containerRef.current) {
                                                        const containerWidth = containerRef.current.clientWidth - 48;
                                                        pdfInstance.getPage(currentPage).then((page: any) => {
                                                            const pageWidth = page.view[2] - page.view[0];
                                                            const fitScale = Math.floor((containerWidth / pageWidth) * 100);
                                                            setZoom(fitScale);
                                                        });
                                                    }
                                                }}
                                                className="glass p-2 rounded-lg hover:bg-white/10"
                                                title="Fit to Width"
                                            >
                                                <Maximize size={14} />
                                            </motion.button>
                                        </div>
                                    </div>

                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={handleRotate}
                                        className="w-full glass px-4 py-2 rounded-lg flex items-center justify-between hover:bg-white/10"
                                    >
                                        <span className="text-sm">Rotate</span>
                                        <RotateCw size={16} />
                                    </motion.button>
                                </div>
                            </div>

                            {pdfFile && numPages > 1 && (
                                <div className="mt-6 pt-6 border-t border-white/10">
                                    <h3 className="text-sm font-semibold mb-3">Pages</h3>
                                    <div className="flex items-center justify-between">
                                        <motion.button
                                            whileHover={{ scale: 1.1 }}
                                            whileTap={{ scale: 0.9 }}
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            className="glass p-2 rounded-lg hover:bg-white/10 disabled:opacity-50"
                                        >
                                            ←
                                        </motion.button>
                                        <span className="text-sm">
                                            {currentPage} / {numPages}
                                        </span>
                                        <motion.button
                                            whileHover={{ scale: 1.1 }}
                                            whileTap={{ scale: 0.9 }}
                                            onClick={() => setCurrentPage(prev => Math.min(numPages, prev + 1))}
                                            disabled={currentPage === numPages}
                                            className="glass p-2 rounded-lg hover:bg-white/10 disabled:opacity-50"
                                        >
                                            →
                                        </motion.button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.aside>

                    {/* Main Canvas */}
                    <motion.main
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="col-span-9"
                    >
                        <div className="glass-strong rounded-2xl p-8 min-h-[600px]">
                            {isOcrRunning ? (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="h-full flex flex-col items-center justify-center text-center p-12"
                                >
                                    <div className="relative w-32 h-32 mb-8">
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                                            className="absolute inset-0 border-4 border-neural-500/20 border-t-neural-500 rounded-full"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Loader2 className="text-neural-500 animate-spin" size={40} />
                                        </div>
                                    </div>
                                    <h3 className="text-2xl font-bold mb-4 bg-gradient-to-r from-neural-400 to-white bg-clip-text text-transparent">
                                        {ocrStatus}
                                    </h3>
                                    <div className="w-full max-w-md bg-white/5 h-2 rounded-full overflow-hidden mb-4">
                                        <motion.div
                                            className="h-full bg-gradient-neural"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${ocrProgress}%` }}
                                        />
                                    </div>
                                    <p className="text-sm text-gray-400 animate-pulse">
                                        Using local Neural OCR. This may take a few seconds...
                                    </p>
                                </motion.div>
                            ) : pendingScannedFile ? (
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="h-full flex flex-col items-center justify-center text-center p-12"
                                >
                                    <div className="w-24 h-24 rounded-3xl bg-orange-500/10 flex items-center justify-center mb-8 border border-orange-500/20">
                                        <AlertTriangle className="text-orange-500" size={48} />
                                    </div>
                                    <h3 className="text-3xl font-bold mb-4">Scanned PDF Detected</h3>
                                    <p className="text-gray-400 mb-8 max-w-md text-lg leading-relaxed">
                                        This document appears to be an image. Standard text editing is disabled unless we perform <span className="text-neural-400 font-semibold">Neural OCR</span> to reconstruct the text layers.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-4">
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={processScannedFile}
                                            className="bg-gradient-neural px-8 py-4 rounded-2xl font-bold text-white shadow-xl shadow-neural-500/30 flex items-center gap-3"
                                        >
                                            <Edit3 size={20} />
                                            Convert to Editable Text
                                        </motion.button>
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => {
                                                setPdfFile(pendingScannedFile);
                                                setPdfUrl(URL.createObjectURL(pendingScannedFile));
                                                setPendingScannedFile(null);
                                            }}
                                            className="glass px-8 py-4 rounded-2xl font-semibold border-white/10 hover:bg-white/5 transition-all"
                                        >
                                            Open as Image Only
                                        </motion.button>
                                    </div>
                                </motion.div>
                            ) : !pdfFile ? (
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="h-full flex flex-col items-center justify-center text-center"
                                >
                                    <div className="w-24 h-24 rounded-2xl bg-gradient-neural/20 flex items-center justify-center mb-6">
                                        <Upload className="text-neural-400" size={48} />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-2">Upload Your PDF</h3>
                                    <p className="text-gray-400 mb-6 max-w-md">
                                        Upload your PDF file to start editing text, adding annotations, and more
                                    </p>
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => fileInputRef.current?.click()}
                                        className="bg-gradient-neural px-8 py-3 rounded-xl font-medium hover:shadow-lg hover:shadow-neural-500/50 transition-all"
                                    >
                                        Choose PDF File
                                    </motion.button>
                                </motion.div>
                            ) : (
                                <div className="space-y-6">
                                    <div ref={containerRef} className="relative overflow-auto max-h-[75vh] custom-scrollbar rounded-xl bg-black/20 p-4 border border-white/5">
                                        <div
                                            ref={canvasRef}
                                            className="relative shadow-2xl overflow-hidden bg-white"
                                            style={{
                                                transform: `rotate(${rotation}deg)`,
                                                transition: 'all 0.3s ease',
                                                cursor: isAnyEditing ? 'default' : (activeTool === 'region' ? 'crosshair' : activeTool === 'text' ? 'text' : activeTool === 'select' ? 'pointer' : 'default'),
                                                width: 'fit-content',
                                                filter: isAnyEditing ? 'brightness(0.95)' : 'none'
                                            }}
                                            onMouseDown={handleMouseDown}
                                            onMouseMove={handleMouseMove}
                                            onMouseUp={handleMouseUp}
                                            spellCheck={false}
                                            data-gramm={false}
                                        >
                                            <div className="relative">
                                                <Document
                                                    file={pdfUrl}
                                                    onLoadSuccess={onDocumentLoadSuccess}
                                                    onLoadError={(error) => {
                                                        console.error('PDF Document Load Error:', error);
                                                        alert('Engine Error: Failed to load PDF. This usually happens if the PDF worker fails to initialize. Please try refreshing or check the console.');
                                                    }}
                                                    loading={
                                                        <div className="flex flex-col items-center justify-center p-20 space-y-4">
                                                            <Loader2 className="w-12 h-12 text-neural-500 animate-spin" />
                                                            <p className="text-gray-400">Initializing PDF Engine...</p>
                                                        </div>
                                                    }
                                                    className="shadow-2xl"
                                                >
                                                    <Page
                                                        pageNumber={currentPage}
                                                        scale={zoom / 100}
                                                        onLoadSuccess={onPageLoadSuccess}
                                                        renderAnnotationLayer={true}
                                                        renderTextLayer={true}
                                                        className="overflow-hidden"
                                                    />
                                                </Document>
                                            </div>

                                            {/* Drag Selection Visualizer */}
                                            {dragStart && dragEnd && (
                                                <div
                                                    className="absolute border-2 border-neural-500 bg-neural-500/10 z-30 pointer-events-none"
                                                    style={{
                                                        left: Math.min(dragStart.x, dragEnd.x) * (zoom / 100),
                                                        top: Math.min(dragStart.y, dragEnd.y) * (zoom / 100),
                                                        width: Math.abs(dragStart.x - dragEnd.x) * (zoom / 100),
                                                        height: Math.abs(dragStart.y - dragEnd.y) * (zoom / 100),
                                                    }}
                                                />
                                            )}

                                            {/* Text Edits Overlay */}
                                            {textEdits.map((edit) => (
                                                <div
                                                    key={edit.id}
                                                    className="absolute"
                                                    style={{
                                                        left: `${edit.x * (zoom / 100)}px`,
                                                        top: `${edit.y * (zoom / 100)}px`,
                                                        pointerEvents: 'auto',
                                                        zIndex: edit.isEditing ? 100 : 60,
                                                        width: edit.isEditing ? 'max-content' : 'auto',
                                                        minWidth: edit.isEditing ? '120px' : 'auto'
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                >

                                                    {edit.isEditing ? (
                                                        <>
                                                            <input
                                                                type="text"
                                                                value={edit.text}
                                                                onChange={(e) => handleTextChange(edit.id, e.target.value)}
                                                                onKeyDown={(e) => handleKeyDown(e, edit.id)}
                                                                spellCheck={false}
                                                                className="px-1 py-0 border-none text-black outline-none bg-white leading-tight shadow-lg ring-2 ring-neural-500 rounded-sm"
                                                                style={{
                                                                    fontSize: `${edit.fontSize * (zoom / 100)}px`,
                                                                    color: edit.color || '#000000',
                                                                    fontFamily: 'Helvetica, Arial, sans-serif',
                                                                    fontWeight: edit.fontWeight || 'normal',
                                                                    fontStyle: edit.fontStyle || 'normal',
                                                                    minHeight: `${(edit.fontSize + 4) * (zoom / 100)}px`,
                                                                    minWidth: '120px',
                                                                    textAlign: 'left',
                                                                    whiteSpace: 'nowrap',
                                                                    display: 'block'
                                                                }}
                                                                autoFocus
                                                            />
                                                            <div className="absolute top-full left-0 mt-2 flex items-center justify-between gap-2 p-1 bg-white rounded-md shadow-2xl border border-gray-100 z-[110] pointer-events-auto">
                                                                <div className="flex items-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        value={edit.fontSize}
                                                                        onChange={(e) => {
                                                                            const val = parseInt(e.target.value);
                                                                            setTextEdits(prev => prev.map(item => item.id === edit.id ? { ...item, fontSize: val } : item));
                                                                        }}
                                                                        className="w-12 text-xs p-1 rounded border border-gray-200 text-black"
                                                                        title="Font Size"
                                                                    />
                                                                    <input
                                                                        type="color"
                                                                        value={edit.color || '#000000'}
                                                                        onChange={(e) => {
                                                                            setTextEdits(prev => prev.map(item => item.id === edit.id ? { ...item, color: e.target.value, isModified: true } : item));
                                                                        }}
                                                                        onMouseDown={(e) => e.stopPropagation()}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="w-6 h-6 p-0 rounded border-none cursor-pointer hover:scale-110 transition-transform"
                                                                        title="Text Color"
                                                                    />
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setTextEdits(prev => prev.map(item => item.id === edit.id ? { ...item, fontWeight: item.fontWeight === 'bold' ? 'normal' : 'bold', isModified: true } : item));
                                                                        }}
                                                                        className={`p-1 rounded transition-colors ${edit.fontWeight === 'bold' ? 'bg-neural-500 text-white' : 'hover:bg-gray-100 text-black'}`}
                                                                        title="Bold"
                                                                    >
                                                                        <Bold size={14} />
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setTextEdits(prev => prev.map(item => item.id === edit.id ? { ...item, fontStyle: item.fontStyle === 'italic' ? 'normal' : 'italic', isModified: true } : item));
                                                                        }}
                                                                        className={`p-1 rounded transition-colors ${edit.fontStyle === 'italic' ? 'bg-neural-500 text-white' : 'hover:bg-gray-100 text-black'}`}
                                                                        title="Italic"
                                                                    >
                                                                        <Italic size={14} />
                                                                    </button>
                                                                </div>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (window.confirm('Delete this text?')) {
                                                                            setTextEdits(prev => prev.filter(item => item.id !== edit.id));
                                                                            saveToHistory(textEdits.filter(item => item.id !== edit.id));
                                                                            setSelectedTextId(null);
                                                                        }
                                                                    }}
                                                                    className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors"
                                                                    title="Delete"
                                                                >
                                                                    <Eraser size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleTextEditComplete(edit.id)}
                                                                    className="px-3 py-1 bg-neural-500 text-white text-xs font-bold rounded hover:bg-neural-600 transition-colors flex items-center gap-1"
                                                                >
                                                                    <Check size={14} />
                                                                    DONE
                                                                </button>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleTextEditStart(edit.id);
                                                            }}
                                                            className={`cursor-pointer px-1 py-0 rounded transition-all leading-tight ${isAnyEditing && !edit.isEditing ? 'opacity-30 grayscale cursor-not-allowed' : 'hover:bg-neural-500/10'}`}
                                                            style={{
                                                                cursor: activeTool === 'select' && !isAnyEditing ? 'move' : 'pointer',
                                                                fontSize: `${edit.fontSize * (zoom / 100)}px`,
                                                                color: edit.isModified ? (edit.color || '#000000') : 'transparent',
                                                                fontFamily: 'Helvetica, Arial, sans-serif',
                                                                fontWeight: edit.fontWeight || 'normal',
                                                                fontStyle: edit.fontStyle || 'normal',
                                                                minWidth: edit.width ? `${(edit.width + 12) * (zoom / 100)}px` : 'fit-content',
                                                                minHeight: `${(edit.fontSize + 8) * (zoom / 100)}px`,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                padding: `0 ${6 * (zoom / 100)}px`,
                                                                backgroundColor: edit.isModified ? 'white' : 'transparent',
                                                                border: selectedTextId === edit.id ? '1px solid #6366f1' : 'none',
                                                                pointerEvents: isAnyEditing && !edit.isEditing ? 'none' : 'auto',
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'visible'
                                                            }}
                                                        >
                                                            {edit.text}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Status Bar */}
                                    <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
                                        <div className="flex items-center gap-4">
                                            <span>📄 {pdfFile.name}</span>
                                            <span>•</span>
                                            <span>{(pdfFile.size / 1024).toFixed(2)} KB</span>
                                            {numPages > 0 && (
                                                <>
                                                    <span>•</span>
                                                    <span>{numPages} pages</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div
                                                className={`w-2 h-2 rounded-full ${isScanning ? 'bg-orange-500 animate-spin' : 'bg-green-500'} animate-pulse`}
                                            />
                                            <span className="flex items-center gap-2">
                                                {textEdits.some(e => e.id.startsWith(`scan-${currentPage}-`))
                                                    ? 'Standard PDF Ready'
                                                    : isScanning
                                                        ? 'Scanning Page...'
                                                        : 'Scanned PDF Mode (Drag to edit)'
                                                }
                                                {!isScanning && (
                                                    <button
                                                        onClick={scanCurrentPage}
                                                        className="hover:text-neural-400 transition-colors"
                                                        title="Re-scan Page"
                                                    >
                                                        <RotateCw size={12} />
                                                    </button>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.main>
                </div>
            </div>

            {/* Feature Cards */}
            <motion.section
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="max-w-7xl mx-auto px-6 py-12"
            >
                <h2 className="text-3xl font-bold text-center mb-8 bg-gradient-to-r from-neural-400 to-neural-600 bg-clip-text text-transparent">
                    Powerful Features
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        {
                            icon: <Edit3 size={32} />,
                            title: 'Text Editing',
                            description: 'Click on text to edit existing content or add new text anywhere',
                        },
                        {
                            icon: <Type size={32} />,
                            title: 'Rich Formatting',
                            description: 'Customize font size, style, and positioning with precision',
                        },
                        {
                            icon: <Highlighter size={32} />,
                            title: 'Annotations',
                            description: 'Highlight and annotate important sections of your PDF',
                        },
                    ].map((feature, index) => (
                        <motion.div
                            key={index}
                            initial={{ y: 50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.5 + index * 0.1 }}
                            whileHover={{ y: -8, scale: 1.02 }}
                            className="glass-strong rounded-2xl p-6 hover:shadow-xl hover:shadow-neural-500/20 transition-all"
                        >
                            <div className="w-16 h-16 rounded-xl bg-gradient-neural/20 flex items-center justify-center mb-4 text-neural-400">
                                {feature.icon}
                            </div>
                            <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                            <p className="text-gray-400">{feature.description}</p>
                        </motion.div>
                    ))}
                </div>
            </motion.section>
        </div>
    );
}
