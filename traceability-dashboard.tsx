import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, ClipboardList, LayoutDashboard, Download, RotateCcw, Loader2, Camera, FileText, Clipboard, FileDown, Save, FolderOpen, X } from 'lucide-react';

const PROCESS_OPTIONS = ['Plant 1', 'Plant 2', 'Plant 3', 'Vibro Process', 'Metal Detector Process', 'Metal Separator Process', 'Fan Process', 'HPS Process'];

const FIXED_SECTION_CONFIG = [
  { key: 'packing', label: 'During Packing / Before Stuffing Check' },
  { key: 'stuffing', label: 'During Stuffing Check' },
  { key: 'cooking', label: 'Cooking Test' },
];

const emptyHeader = {
  date: '',
  invoiceNo: '',
  contractNo: '',
  customerName: '',
  productName: '',
  quality: '',
  supplierName: '',
};

const HEADER_FIELDS = [
  { key: 'date', label: 'Date', type: 'text', placeholder: 'DD/MM/YYYY' },
  { key: 'invoiceNo', label: 'Invoice No.', type: 'text' },
  { key: 'contractNo', label: 'Contract No.', type: 'text' },
  { key: 'customerName', label: 'Customer Name', type: 'text' },
  { key: 'productName', label: 'Product Name', type: 'text' },
  { key: 'quality', label: 'Quality', type: 'text' },
  { key: 'supplierName', label: 'Supplier Name', type: 'text' },
];

let idCounter = 0;
const newId = () => `row_${Date.now()}_${idCounter++}`;
const newRow = () => ({ id: newId(), date: '', time: '', result: '', resultUnit: '', analysisBy: '' });
const newProductionBlock = (process) => ({ id: newId(), process: process || PROCESS_OPTIONS[0], rows: [newRow(), newRow()] });
const newPackingMaterialEntry = () => ({ id: newId(), productName: '', images: [null, null] });
const newWeightEntry = () => ({ id: newId(), note: '', images: [null, null, null, null, null, null] });

const emptySections = () => ({
  production: [newProductionBlock()],
  packing: [newRow(), newRow()],
  stuffing: [newRow()],
  cooking: [newRow()],
  packingMaterials: [newPackingMaterialEntry()],
  weights: [newWeightEntry()],
});

const DRAFT_KEY = 'traceability-draft-v3';
const RECORDS_LIST_KEY = 'traceability-records-list-v3';

const IMAGE_PROMPT = 'This image shows a quality-check log table with columns for Date, Time, Result (a numeric value, which may include a unit like %, kg, ppm, mm, etc.), and Analysis By (a person\'s name or initials). Read every row visible in the image, top to bottom. Respond with ONLY a JSON array, no markdown formatting, no code fences, no explanation. Each item must be an object like {"date": "", "time": "", "result": "", "resultUnit": "", "analysisBy": ""}. Use an empty string for any field that is blank, illegible, or not applicable. Write dates as DD/MM/YYYY where possible. Write result as a plain numeric string without units or symbols, and put any unit (%, kg, ppm, mm, etc.) separately in resultUnit.';

const TEXT_PROMPT_PREFIX = 'The text below contains rows of quality-check data, each with a Date, Time, Result (a numeric value, possibly with a unit like %, kg, ppm, mm attached), and Analysis By (a person\'s name or initials), in some order, possibly separated by spaces, tabs, commas, or new lines, and possibly with extra notes mixed in. Parse it into individual rows. Respond with ONLY a JSON array, no markdown formatting, no code fences, no explanation. Each item must be an object like {"date": "", "time": "", "result": "", "resultUnit": "", "analysisBy": ""}. Use an empty string for any field missing from a row. Write dates as DD/MM/YYYY where possible, result as a plain numeric string without units, and put any unit separately in resultUnit. Here is the text:\n\n';

const IMAGE_HEADER_PROMPT = 'This image shows a shipment or invoice document containing details such as Date, Invoice Number, Contract Number, Customer Name, Product Name, Quality/Grade, and Supplier Name. Read these details from the image. Respond with ONLY a JSON object, no markdown formatting, no code fences, no explanation, with exactly these keys: {"date": "", "invoiceNo": "", "contractNo": "", "customerName": "", "productName": "", "quality": "", "supplierName": ""}. Use an empty string for any field that is blank, illegible, or not present. Write the date as DD/MM/YYYY where possible.';

const TEXT_HEADER_PREFIX = 'The text below contains shipment or invoice details such as Date, Invoice Number, Contract Number, Customer Name, Product Name, Quality/Grade, and Supplier Name, possibly in any order or format, with extra text mixed in. Extract these details. Respond with ONLY a JSON object, no markdown formatting, no code fences, no explanation, with exactly these keys: {"date": "", "invoiceNo": "", "contractNo": "", "customerName": "", "productName": "", "quality": "", "supplierName": ""}. Use an empty string for any field not present. Write the date as DD/MM/YYYY where possible. Here is the text:\n\n';

function resizeImage(file, maxDim = 1400, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function resizeImageForStorage(file) {
  return resizeImage(file, 700, 0.7);
}

function parseRowsFromResponse(data) {
  const textBlock = (data.content || []).find(c => c.type === 'text');
  if (!textBlock) throw new Error('empty response');
  let clean = textBlock.text.trim();
  clean = clean.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed)) throw new Error('not an array');
  return parsed.map(r => ({
    id: newId(),
    date: r.date ? String(r.date) : '',
    time: r.time ? String(r.time) : '',
    result: r.result !== undefined && r.result !== null ? String(r.result) : '',
    resultUnit: r.resultUnit ? String(r.resultUnit) : '',
    analysisBy: r.analysisBy ? String(r.analysisBy) : '',
    include: true,
  }));
}

function parseHeaderFromResponse(data) {
  const textBlock = (data.content || []).find(c => c.type === 'text');
  if (!textBlock) throw new Error('empty response');
  let clean = textBlock.text.trim();
  clean = clean.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(clean);
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) throw new Error('not an object');
  return {
    date: parsed.date ? String(parsed.date) : '',
    invoiceNo: parsed.invoiceNo ? String(parsed.invoiceNo) : '',
    contractNo: parsed.contractNo ? String(parsed.contractNo) : '',
    customerName: parsed.customerName ? String(parsed.customerName) : '',
    productName: parsed.productName ? String(parsed.productName) : '',
    quality: parsed.quality ? String(parsed.quality) : '',
    supplierName: parsed.supplierName ? String(parsed.supplierName) : '',
  };
}

function countLogged(sections) {
  let total = 0, logged = 0;
  const prodBlocks = (sections.production || []);
  prodBlocks.forEach(b => {
    const rows = b.rows || [];
    total += rows.length;
    logged += rows.filter(r => r.result !== '' && !isNaN(parseFloat(r.result))).length;
  });
  FIXED_SECTION_CONFIG.forEach(sec => {
    const rows = sections[sec.key] || [];
    total += rows.length;
    logged += rows.filter(r => r.result !== '' && !isNaN(parseFloat(r.result))).length;
  });
  return { total, logged };
}

function normalizeSections(raw) {
  const fixed = {};
  if (Array.isArray(raw && raw.production) && raw.production.length && raw.production[0] && raw.production[0].rows) {
    fixed.production = raw.production.map(b => ({
      id: b.id || newId(),
      process: b.process || PROCESS_OPTIONS[0],
      rows: Array.isArray(b.rows) && b.rows.length ? b.rows : [newRow()],
    }));
  } else if (Array.isArray(raw && raw.production) && raw.production.length) {
    fixed.production = [{ id: newId(), process: PROCESS_OPTIONS[0], rows: raw.production }];
  } else {
    fixed.production = [newProductionBlock()];
  }
  FIXED_SECTION_CONFIG.forEach(sec => {
    const rows = raw && raw[sec.key];
    fixed[sec.key] = Array.isArray(rows) && rows.length ? rows : [newRow()];
  });
  fixed.packingMaterials = Array.isArray(raw && raw.packingMaterials) && raw.packingMaterials.length
    ? raw.packingMaterials.map(e => ({
        id: e.id || newId(),
        productName: e.productName || e.materialType || '',
        images: Array.isArray(e.images) && e.images.length
          ? [e.images[0] || null, e.images[1] || null]
          : [e.image || null, null],
      }))
    : [newPackingMaterialEntry()];
  fixed.weights = Array.isArray(raw && raw.weights) && raw.weights.length
    ? raw.weights.map(e => {
        const baseImages = Array.isArray(e.images) ? e.images.slice(0, 6) : (e.image ? [e.image] : []);
        while (baseImages.length < 6) baseImages.push(null);
        return { id: e.id || newId(), note: e.note || '', images: baseImages };
      })
    : [newWeightEntry()];
  return fixed;
}

export default function TraceabilityDashboard() {
  const [tab, setTab] = useState('entry');
  const [header, setHeader] = useState(emptyHeader);
  const [unit, setUnit] = useState('');
  const [range, setRange] = useState({ min: '', max: '' });
  const [sections, setSections] = useState(emptySections());
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading…');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [jspdfLoaded, setJspdfLoaded] = useState(typeof window !== 'undefined' && !!window.jspdf);

  useEffect(() => {
    if (window.jspdf) { setJspdfLoaded(true); return; }
    const existing = document.querySelector('script[data-jspdf]');
    if (existing) {
      existing.addEventListener('load', () => setJspdfLoaded(true));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.setAttribute('data-jspdf', 'true');
    script.onload = () => setJspdfLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const draftRes = await window.storage.get(DRAFT_KEY, false);
        if (mounted && draftRes && draftRes.value) {
          const d = JSON.parse(draftRes.value);
          if (d.header) setHeader({ ...emptyHeader, ...d.header });
          if (d.unit !== undefined) setUnit(d.unit);
          if (d.range) setRange(d.range);
          if (d.sections) setSections(normalizeSections(d.sections));
          if (d.editingRecordId) setEditingRecordId(d.editingRecordId);
        }
      } catch (e) { /* no draft yet */ }

      try {
        const listRes = await window.storage.get(RECORDS_LIST_KEY, false);
        if (mounted && listRes && listRes.value) {
          const list = JSON.parse(listRes.value);
          if (Array.isArray(list)) setRecords(list);
        }
      } catch (e) { /* no records yet */ }

      if (mounted) {
        setLoaded(true);
        setStatus('');
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      try {
        await window.storage.set(DRAFT_KEY, JSON.stringify({ header, unit, range, sections, editingRecordId }), false);
      } catch (e) { /* ignore */ }
    }, 600);
    return () => clearTimeout(t);
  }, [header, unit, range, sections, editingRecordId, loaded]);

  const persistRecords = async (next) => {
    setRecords(next);
    try {
      const result = await window.storage.set(RECORDS_LIST_KEY, JSON.stringify(next), false);
      if (!result) throw new Error('save returned null');
      setStatus('Saved');
    } catch (e) {
      setStatus('Save failed — try removing some attached images, storage may be full');
    }
  };

  const updateHeader = (key, value) => setHeader(h => ({ ...h, [key]: value }));

  // Production block helpers
  const addProductionBlock = () => {
    setSections(s => ({ ...s, production: [...s.production, newProductionBlock()] }));
  };
  const removeProductionBlock = (blockId) => {
    setSections(s => ({
      ...s,
      production: s.production.length > 1 ? s.production.filter(b => b.id !== blockId) : s.production,
    }));
  };
  const updateProductionProcess = (blockId, process) => {
    setSections(s => ({
      ...s,
      production: s.production.map(b => b.id === blockId ? { ...b, process } : b),
    }));
  };
  const addProductionRow = (blockId) => {
    setSections(s => ({
      ...s,
      production: s.production.map(b => b.id === blockId ? { ...b, rows: [...b.rows, newRow()] } : b),
    }));
  };
  const removeProductionRow = (blockId, rowId) => {
    setSections(s => ({
      ...s,
      production: s.production.map(b => b.id === blockId ? { ...b, rows: b.rows.length > 1 ? b.rows.filter(r => r.id !== rowId) : b.rows } : b),
    }));
  };
  const updateProductionRow = (blockId, rowId, field, value) => {
    setSections(s => ({
      ...s,
      production: s.production.map(b => b.id === blockId ? { ...b, rows: b.rows.map(r => r.id === rowId ? { ...r, [field]: value } : r) } : b),
    }));
  };

  // Fixed section (packing/stuffing/cooking) helpers
  const addRow = (sectionKey) => {
    setSections(s => ({ ...s, [sectionKey]: [...s[sectionKey], newRow()] }));
  };
  const removeRow = (sectionKey, id) => {
    setSections(s => ({
      ...s,
      [sectionKey]: s[sectionKey].length > 1 ? s[sectionKey].filter(r => r.id !== id) : s[sectionKey],
    }));
  };
  const updateRow = (sectionKey, id, field, value) => {
    setSections(s => ({
      ...s,
      [sectionKey]: s[sectionKey].map(r => r.id === id ? { ...r, [field]: value } : r),
    }));
  };

  // Packing material entry helpers
  const addPackingMaterial = () => {
    setSections(s => ({ ...s, packingMaterials: [...s.packingMaterials, newPackingMaterialEntry()] }));
  };
  const removePackingMaterial = (id) => {
    setSections(s => ({
      ...s,
      packingMaterials: s.packingMaterials.length > 1 ? s.packingMaterials.filter(e => e.id !== id) : s.packingMaterials,
    }));
  };
  const updatePackingMaterial = (id, field, value) => {
    setSections(s => ({
      ...s,
      packingMaterials: s.packingMaterials.map(e => e.id === id ? { ...e, [field]: value } : e),
    }));
  };

  // Weight entry helpers
  const addWeightEntry = () => {
    setSections(s => ({ ...s, weights: [...s.weights, newWeightEntry()] }));
  };
  const removeWeightEntry = (id) => {
    setSections(s => ({
      ...s,
      weights: s.weights.length > 1 ? s.weights.filter(e => e.id !== id) : s.weights,
    }));
  };
  const updateWeightEntry = (id, field, value) => {
    setSections(s => ({
      ...s,
      weights: s.weights.map(e => e.id === id ? { ...e, [field]: value } : e),
    }));
  };

  const startNewRecord = () => {
    setHeader(emptyHeader);
    setUnit('');
    setRange({ min: '', max: '' });
    setSections(emptySections());
    setEditingRecordId(null);
    setConfirmReset(false);
  };

  const saveRecord = async () => {
    const id = editingRecordId || newId();
    const recordData = { id, header, unit, range, sections, savedAt: new Date().toISOString() };
    const exists = records.some(r => r.id === id);
    const next = exists ? records.map(r => r.id === id ? recordData : r) : [...records, recordData];
    await persistRecords(next);
    setEditingRecordId(id);
    setStatus('Record saved');
  };

  const openRecord = (record) => {
    setHeader({ ...emptyHeader, ...record.header });
    setUnit(record.unit || '');
    setRange(record.range || { min: '', max: '' });
    setSections(normalizeSections(record.sections));
    setEditingRecordId(record.id);
    setTab('entry');
  };

  const deleteRecord = async (id) => {
    const next = records.filter(r => r.id !== id);
    await persistRecords(next);
    if (editingRecordId === id) startNewRecord();
    setConfirmDeleteId(null);
  };

  const getStats = (rows) => {
    const values = rows.map(r => parseFloat(r.result)).filter(v => !isNaN(v));
    const rmin = parseFloat(range.min), rmax = parseFloat(range.max);
    const hasRangeLocal = range.min !== '' && range.max !== '' && !isNaN(rmin) && !isNaN(rmax);
    const out = hasRangeLocal ? values.filter(v => v < rmin || v > rmax).length : 0;
    return {
      total: rows.length,
      logged: values.length,
      avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      out,
    };
  };

  const hasRange = range.min !== '' && range.max !== '' && !isNaN(parseFloat(range.min)) && !isNaN(parseFloat(range.max));

  const exportCSV = () => {
    const rows = [];
    rows.push(['TRACEABILITY RECORD']);
    HEADER_FIELDS.forEach(f => rows.push([f.label, header[f.key] || '']));
    rows.push([]);
    sections.production.forEach(block => {
      rows.push([`Production Check – ${block.process}`]);
      rows.push(['Sr. No.', 'Date', 'Time', 'Result', 'Unit', 'Analysis By']);
      block.rows.forEach((r, i) => rows.push([i + 1, r.date, r.time, r.result, r.resultUnit || unit, r.analysisBy]));
      rows.push([]);
    });
    FIXED_SECTION_CONFIG.forEach(sec => {
      rows.push([sec.label]);
      rows.push(['Sr. No.', 'Date', 'Time', 'Result', 'Unit', 'Analysis By']);
      sections[sec.key].forEach((r, i) => rows.push([i + 1, r.date, r.time, r.result, r.resultUnit || unit, r.analysisBy]));
      rows.push([]);
    });
    rows.push(['Packing Material Details']);
    rows.push(['Sr. No.', 'Product Name', 'Images Attached']);
    sections.packingMaterials.forEach((e, i) => rows.push([i + 1, e.productName, e.images.filter(Boolean).length]));
    rows.push([]);
    rows.push(['Weight Analysis Pictures']);
    rows.push(['Sr. No.', 'Note', 'Images Attached']);
    sections.weights.forEach((e, i) => rows.push([i + 1, e.note, e.images.filter(Boolean).length]));
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traceability_${header.invoiceNo || 'record'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildDocHtml = () => {
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const headerRows = HEADER_FIELDS.map(f => `<tr><td style="font-weight:bold;width:160px;border:1px solid #999;padding:4px 8px;">${esc(f.label)}</td><td style="border:1px solid #999;padding:4px 8px;">${esc(header[f.key])}</td></tr>`).join('');

    const tableFor = (title, rows) => {
      const rowsHtml = rows.map((r, i) => `<tr>
          <td style="border:1px solid #999;padding:4px 8px;text-align:center;">${i + 1}</td>
          <td style="border:1px solid #999;padding:4px 8px;">${esc(r.date)}</td>
          <td style="border:1px solid #999;padding:4px 8px;">${esc(r.time)}</td>
          <td style="border:1px solid #999;padding:4px 8px;">${esc(r.result)}</td>
          <td style="border:1px solid #999;padding:4px 8px;">${esc(r.resultUnit || unit)}</td>
          <td style="border:1px solid #999;padding:4px 8px;">${esc(r.analysisBy)}</td>
        </tr>`).join('');
      return `
        <h3 style="margin-top:24px;">${esc(title)}</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <tr style="background:#e8e8e8;">
            <th style="border:1px solid #999;padding:4px 8px;">Sr. No.</th>
            <th style="border:1px solid #999;padding:4px 8px;">Date</th>
            <th style="border:1px solid #999;padding:4px 8px;">Time</th>
            <th style="border:1px solid #999;padding:4px 8px;">Result</th>
            <th style="border:1px solid #999;padding:4px 8px;">Unit</th>
            <th style="border:1px solid #999;padding:4px 8px;">Analysis By</th>
          </tr>
          ${rowsHtml}
        </table>`;
    };

    const productionHtml = sections.production.map(b => tableFor(`Production Check – ${b.process}`, b.rows)).join('');
    const fixedHtml = FIXED_SECTION_CONFIG.map(sec => tableFor(sec.label, sections[sec.key])).join('');

    const packingMaterialsHtml = `
      <h3 style="margin-top:24px;">Packing Material Details</h3>
      ${sections.packingMaterials.map((e, i) => `
        <div style="margin-bottom:12px;border:1px solid #ccc;padding:8px;">
          <p style="margin:0;"><b>Entry ${i + 1}</b> — Product: ${esc(e.productName)}</p>
          <div style="margin-top:6px;">
            ${e.images.filter(Boolean).map(img => `<img src="${img}" style="max-width:150px;margin-right:6px;" />`).join('')}
          </div>
        </div>`).join('')}`;

    const weightsHtml = `
      <h3 style="margin-top:24px;">Weight Analysis Pictures</h3>
      ${sections.weights.map((e, i) => `
        <div style="margin-bottom:12px;border:1px solid #ccc;padding:8px;">
          <p style="margin:0;"><b>Entry ${i + 1}</b> — Note: ${esc(e.note)}</p>
          <div style="margin-top:6px;">
            ${e.images.filter(Boolean).map(img => `<img src="${img}" style="max-width:150px;margin-right:6px;" />`).join('')}
          </div>
        </div>`).join('')}`;

    return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Traceability Record</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; color:#1a1a1a; }
  table { border-collapse: collapse; }
  h1 { font-size: 20px; text-align:center; }
</style>
</head>
<body>
  <h1>TRACEABILITY RECORD</h1>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:20px;">
    ${headerRows}
  </table>
  ${productionHtml}
  ${fixedHtml}
  ${packingMaterialsHtml}
  ${weightsHtml}
</body>
</html>`;
  };

  const exportWord = () => {
    const html = buildDocHtml();
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traceability_${header.invoiceNo || 'record'}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 14;
    let y = 16;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('TRACEABILITY RECORD', pageWidth / 2, y, { align: 'center' });
    y += 10;

    doc.setFontSize(10);
    HEADER_FIELDS.forEach(f => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${f.label}:`, marginX, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(header[f.key] || ''), marginX + 45, y);
      y += 6;
    });
    y += 4;

    const colWidths = [12, 32, 26, 26, 22, pageWidth - 2 * marginX - (12 + 32 + 26 + 26 + 22)];
    const colX = [marginX];
    for (let i = 0; i < colWidths.length - 1; i++) colX.push(colX[i] + colWidths[i]);

    const drawTableHeader = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setFillColor(232, 232, 232);
      doc.rect(marginX, y, pageWidth - 2 * marginX, 7, 'F');
      const labels = ['Sr.', 'Date', 'Time', 'Result', 'Unit', 'Analysis By'];
      labels.forEach((label, i) => doc.text(label, colX[i] + 2, y + 5));
      y += 7;
      doc.setFont('helvetica', 'normal');
    };

    const drawSection = (title, rows) => {
      if (y > 260) { doc.addPage(); y = 16; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(title, marginX, y);
      y += 6;
      drawTableHeader();
      doc.setFontSize(9);
      rows.forEach((r, i) => {
        if (y > 280) { doc.addPage(); y = 16; drawTableHeader(); }
        const rowH = 6;
        doc.rect(marginX, y, pageWidth - 2 * marginX, rowH);
        const vals = [String(i + 1), r.date || '', r.time || '', r.result || '', r.resultUnit || unit || '', r.analysisBy || ''];
        vals.forEach((v, ci) => doc.text(v, colX[ci] + 2, y + 4.2, { maxWidth: colWidths[ci] - 3 }));
        y += rowH;
      });
      y += 8;
    };

    sections.production.forEach(b => drawSection(`Production Check – ${b.process}`, b.rows));
    FIXED_SECTION_CONFIG.forEach(sec => drawSection(sec.label, sections[sec.key]));

    const drawImageEntries = (title, entries, lineFn) => {
      if (y > 250) { doc.addPage(); y = 16; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(title, marginX, y);
      y += 7;
      entries.forEach((e, i) => {
        if (y > 230) { doc.addPage(); y = 16; }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(lineFn(e, i), marginX, y);
        y += 5;
        const imgs = (e.images || []).filter(Boolean);
        if (imgs.length) {
          let x = marginX;
          imgs.forEach(img => {
            if (x + 40 > pageWidth - marginX) { x = marginX; y += 44; }
            if (y > 200) { doc.addPage(); y = 16; x = marginX; }
            try {
              doc.addImage(img, 'JPEG', x, y, 40, 40);
            } catch (err) { /* skip bad image */ }
            x += 44;
          });
          y += 44;
        } else {
          y += 2;
        }
      });
      y += 6;
    };

    drawImageEntries('Packing Material Details', sections.packingMaterials, (e, i) => `Entry ${i + 1}: ${e.productName || '-'}`);
    drawImageEntries('Weight Analysis Pictures', sections.weights, (e, i) => `Entry ${i + 1}: ${e.note || ''}`);

    doc.save(`traceability_${header.invoiceNo || 'record'}.pdf`);
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Header */}
      <div className="bg-indigo-600 text-white px-4 sm:px-8 py-5">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Traceability Dashboard</h1>
            <p className="text-indigo-100 text-sm mt-0.5">
              {header.productName || 'Product'} {header.invoiceNo ? `· Invoice ${header.invoiceNo}` : ''} {header.date ? `· ${header.date}` : ''}
              {editingRecordId ? ' · Editing saved record' : ' · Unsaved draft'}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-indigo-100">{status}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-4 sm:px-8 pt-4">
        <div className="flex gap-2 border-b border-slate-200 overflow-x-auto">
          <button
            onClick={() => setTab('entry')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap ${tab === 'entry' ? 'bg-white border border-slate-200 border-b-white text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <ClipboardList className="w-4 h-4" /> Record Entry
          </button>
          <button
            onClick={() => setTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap ${tab === 'dashboard' ? 'bg-white border border-slate-200 border-b-white text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <LayoutDashboard className="w-4 h-4" /> Dashboard
          </button>
          <button
            onClick={() => setTab('scan')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap ${tab === 'scan' ? 'bg-white border border-slate-200 border-b-white text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Camera className="w-4 h-4" /> Scan / Paste
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        {tab === 'entry' && (
          <>
            {/* Shipment details */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="font-semibold text-slate-700 mb-4">Shipment Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {HEADER_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{f.label}</label>
                    <input
                      type={f.type}
                      value={header[f.key]}
                      onChange={e => updateHeader(f.key, e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                      placeholder={f.placeholder || f.label}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Range settings */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="font-semibold text-slate-700 mb-1">Result Settings</h2>
              <p className="text-xs text-slate-500 mb-4">Optional — set an acceptable range to flag out-of-spec results on the dashboard.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Default Unit</label>
                  <input
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                    placeholder="e.g. %, kg, ppm"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Acceptable Min</label>
                  <input
                    type="number"
                    value={range.min}
                    onChange={e => setRange(r => ({ ...r, min: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Acceptable Max</label>
                  <input
                    type="number"
                    value={range.max}
                    onChange={e => setRange(r => ({ ...r, max: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                  />
                </div>
              </div>
            </div>

            {/* Production check blocks */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">During Production Check</h2>
                <button onClick={addProductionBlock} className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
                  <Plus className="w-4 h-4" /> Add Process
                </button>
              </div>

              {sections.production.map(block => (
                <div key={block.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-500">Process</label>
                      <select
                        value={block.process}
                        onChange={e => updateProductionProcess(block.id, e.target.value)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      >
                        {PROCESS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">{block.rows.length} entries</span>
                      {sections.production.length > 1 && (
                        <button onClick={() => removeProductionBlock(block.id)} className="text-slate-400 hover:text-red-500" title="Remove this process block">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="overflow-x-auto -mx-2">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>
                        <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                          <th className="py-2 px-2 w-12">Sr.</th>
                          <th className="py-2 px-2">Date</th>
                          <th className="py-2 px-2">Time</th>
                          <th className="py-2 px-2">Result{unit ? ` (default: ${unit})` : ''}</th>
                          <th className="py-2 px-2">Analysis By</th>
                          <th className="py-2 px-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, i) => {
                          const val = parseFloat(row.result);
                          const out = hasRange && !isNaN(val) && (val < parseFloat(range.min) || val > parseFloat(range.max));
                          return (
                            <tr key={row.id} className="border-b border-slate-100 last:border-0">
                              <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                              <td className="py-1.5 px-2">
                                <input type="text" value={row.date} onChange={e => updateProductionRow(block.id, row.id, 'date', e.target.value)} placeholder="DD/MM/YYYY"
                                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                              </td>
                              <td className="py-1.5 px-2">
                                <input type="text" value={row.time} onChange={e => updateProductionRow(block.id, row.id, 'time', e.target.value)} placeholder="HH:MM"
                                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                              </td>
                              <td className="py-1.5 px-2">
                                <div className="flex gap-1">
                                  <input type="number" step="any" value={row.result} onChange={e => updateProductionRow(block.id, row.id, 'result', e.target.value)}
                                    className={`w-full min-w-[60px] rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 ${out ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-slate-200 focus:ring-indigo-300'}`} placeholder="0.0" />
                                  <input type="text" value={row.resultUnit} onChange={e => updateProductionRow(block.id, row.id, 'resultUnit', e.target.value)}
                                    className="w-16 rounded-md border border-slate-200 px-1.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder={unit || 'unit'} />
                                </div>
                              </td>
                              <td className="py-1.5 px-2">
                                <input value={row.analysisBy} onChange={e => updateProductionRow(block.id, row.id, 'analysisBy', e.target.value)}
                                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Name" />
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <button onClick={() => removeProductionRow(block.id, row.id)} className="text-slate-400 hover:text-red-500">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={() => addProductionRow(block.id)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
                    <Plus className="w-4 h-4" /> Add Row
                  </button>
                </div>
              ))}
            </div>

            {/* Fixed quality check sections (Packing, Stuffing, Cooking Test) */}
            {FIXED_SECTION_CONFIG.map(sec => (
              <div key={sec.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-slate-700">{sec.label}</h2>
                  <span className="text-xs text-slate-400">{sections[sec.key].length} entries</span>
                </div>
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                        <th className="py-2 px-2 w-12">Sr.</th>
                        <th className="py-2 px-2">Date</th>
                        <th className="py-2 px-2">Time</th>
                        <th className="py-2 px-2">Result{unit ? ` (default: ${unit})` : ''}</th>
                        <th className="py-2 px-2">Analysis By</th>
                        <th className="py-2 px-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections[sec.key].map((row, i) => {
                        const val = parseFloat(row.result);
                        const out = hasRange && !isNaN(val) && (val < parseFloat(range.min) || val > parseFloat(range.max));
                        return (
                          <tr key={row.id} className="border-b border-slate-100 last:border-0">
                            <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                            <td className="py-1.5 px-2">
                              <input type="text" value={row.date} onChange={e => updateRow(sec.key, row.id, 'date', e.target.value)} placeholder="DD/MM/YYYY"
                                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                            </td>
                            <td className="py-1.5 px-2">
                              <input type="text" value={row.time} onChange={e => updateRow(sec.key, row.id, 'time', e.target.value)} placeholder="HH:MM"
                                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="flex gap-1">
                                <input type="number" step="any" value={row.result} onChange={e => updateRow(sec.key, row.id, 'result', e.target.value)}
                                  className={`w-full min-w-[60px] rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 ${out ? 'border-red-300 bg-red-50 focus:ring-red-300' : 'border-slate-200 focus:ring-indigo-300'}`} placeholder="0.0" />
                                <input type="text" value={row.resultUnit} onChange={e => updateRow(sec.key, row.id, 'resultUnit', e.target.value)}
                                  className="w-16 rounded-md border border-slate-200 px-1.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder={unit || 'unit'} />
                              </div>
                            </td>
                            <td className="py-1.5 px-2">
                              <input value={row.analysisBy} onChange={e => updateRow(sec.key, row.id, 'analysisBy', e.target.value)}
                                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Name" />
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button onClick={() => removeRow(sec.key, row.id)} className="text-slate-400 hover:text-red-500">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => addRow(sec.key)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
                  <Plus className="w-4 h-4" /> Add Row
                </button>
              </div>
            ))}

            {/* Packing Material Details */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-700">Packing Material Details</h2>
                <span className="text-xs text-slate-400">{sections.packingMaterials.length} entries</span>
              </div>
              <div className="space-y-4">
                {sections.packingMaterials.map((entry, i) => (
                  <div key={entry.id} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-slate-400">Entry {i + 1}</span>
                      {sections.packingMaterials.length > 1 && (
                        <button onClick={() => removePackingMaterial(entry.id)} className="text-slate-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="mb-3 max-w-sm">
                      <label className="block text-xs font-medium text-slate-500 mb-1">Product Name</label>
                      <input value={entry.productName} onChange={e => updatePackingMaterial(entry.id, 'productName', e.target.value)}
                        placeholder="Product name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    </div>
                    <MultiImageAttachField
                      images={entry.images}
                      onChange={imgs => updatePackingMaterial(entry.id, 'images', imgs)}
                    />
                  </div>
                ))}
              </div>
              <button onClick={addPackingMaterial} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
                <Plus className="w-4 h-4" /> Add Entry
              </button>
            </div>

            {/* Weight Analysis */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-700">Weight Analysis Pictures</h2>
                <span className="text-xs text-slate-400">{sections.weights.length} entries</span>
              </div>
              <div className="space-y-4">
                {sections.weights.map((entry, i) => (
                  <div key={entry.id} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-slate-400">Entry {i + 1}</span>
                      {sections.weights.length > 1 && (
                        <button onClick={() => removeWeightEntry(entry.id)} className="text-slate-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="mb-3">
                      <label className="block text-xs font-medium text-slate-500 mb-1">Note</label>
                      <input value={entry.note} onChange={e => updateWeightEntry(entry.id, 'note', e.target.value)}
                        placeholder="e.g. Bag 12, Net weight 25.05 kg" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    </div>
                    <MultiImageAttachField
                      images={entry.images}
                      onChange={imgs => updateWeightEntry(entry.id, 'images', imgs)}
                    />
                  </div>
                ))}
              </div>
              <button onClick={addWeightEntry} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
                <Plus className="w-4 h-4" /> Add Entry
              </button>
            </div>

            {/* Footer actions */}
            <div className="flex flex-wrap gap-3 justify-end">
              <button onClick={saveRecord} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
                <Save className="w-4 h-4" /> {editingRecordId ? 'Update Record' : 'Save Record'}
              </button>
              <button onClick={exportCSV} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-100">
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <button onClick={exportWord} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-100">
                <FileText className="w-4 h-4" /> Export Word
              </button>
              <button
                onClick={exportPDF}
                disabled={!jspdfLoaded}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {jspdfLoaded ? <FileDown className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />} Export PDF
              </button>
              {!confirmReset ? (
                <button onClick={() => setConfirmReset(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-500 hover:bg-red-50">
                  <RotateCcw className="w-4 h-4" /> Start New Record
                </button>
              ) : (
                <div className="inline-flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Discard current draft and start fresh?</span>
                  <button onClick={startNewRecord} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600">Yes, start new</button>
                  <button onClick={() => setConfirmReset(false)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'dashboard' && (
          <DashboardView
            records={records}
            openRecord={openRecord}
            deleteRecord={deleteRecord}
            confirmDeleteId={confirmDeleteId}
            setConfirmDeleteId={setConfirmDeleteId}
            editingRecordId={editingRecordId}
          />
        )}

        {tab === 'scan' && (
          <ScanView setSections={setSections} setHeader={setHeader} />
        )}
      </div>
    </div>
  );
}

function DashboardView({ records, openRecord, deleteRecord, confirmDeleteId, setConfirmDeleteId, editingRecordId }) {
  const sortedRecords = [...records].sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));

  return (
    <div className="space-y-6">
      {/* Saved records overview */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-700">Saved Traceability Records</h2>
          <span className="text-2xl font-bold text-indigo-600">{records.length}</span>
        </div>
        {sortedRecords.length === 0 ? (
          <div className="h-20 flex items-center justify-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
            No records saved yet. Use "Save Record" on the Record Entry tab.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedRecords.map(rec => {
              const { total, logged } = countLogged(rec.sections || {});
              const isCurrent = rec.id === editingRecordId;
              const savedDate = rec.savedAt ? new Date(rec.savedAt) : null;
              return (
                <div key={rec.id} className={`flex flex-wrap items-center justify-between gap-3 border rounded-lg p-3 ${isCurrent ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {rec.header?.productName || 'Untitled product'} {rec.header?.invoiceNo ? `· Inv ${rec.header.invoiceNo}` : ''}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {rec.header?.customerName ? `${rec.header.customerName} · ` : ''}
                      {rec.header?.date ? `${rec.header.date} · ` : ''}
                      {logged}/{total} checks logged
                      {savedDate ? ` · saved ${savedDate.toLocaleDateString()}` : ''}
                      {isCurrent ? ' · currently open' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => openRecord(rec)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-100">
                      <FolderOpen className="w-3.5 h-3.5" /> Open
                    </button>
                    {confirmDeleteId === rec.id ? (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => deleteRecord(rec.id)} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600">Confirm</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-100">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(rec.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-500 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MultiImageAttachField({ images, onChange }) {
  const fileInputRefs = useRef([]);
  const [busyIndex, setBusyIndex] = useState(null);
  const [err, setErr] = useState('');

  const setSlot = (index, value) => {
    const next = [...images];
    next[index] = value;
    onChange(next);
  };

  const handleFile = async (index, file) => {
    if (!file) return;
    setErr('');
    setBusyIndex(index);
    try {
      const dataUrl = await resizeImageForStorage(file);
      setSlot(index, dataUrl);
    } catch (error) {
      setErr('Could not attach that image.');
    } finally {
      setBusyIndex(null);
    }
  };

  const handleFileInputChange = (index, e) => {
    const file = e.target.files && e.target.files[0];
    handleFile(index, file);
  };

  const handlePaste = (index, e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          handleFile(index, file);
          e.preventDefault();
          return;
        }
      }
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {images.map((img, index) => (
          <div key={index} className="flex flex-col items-center">
            {img ? (
              <div className="relative">
                <img src={img} alt={`Attachment ${index + 1}`} className="h-20 w-20 object-cover rounded-lg border border-slate-200" />
                <button
                  onClick={() => setSlot(index, null)}
                  className="absolute -top-2 -right-2 bg-white border border-slate-300 rounded-full p-0.5 text-red-500 hover:bg-red-50"
                  title="Remove image"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div
                tabIndex={0}
                onPaste={(e) => handlePaste(index, e)}
                onClick={() => fileInputRefs.current[index] && fileInputRefs.current[index].click()}
                className="h-20 w-20 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 text-center px-1"
              >
                {busyIndex === index ? (
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                ) : (
                  <>
                    <Camera className="w-4 h-4 text-slate-400 mb-1" />
                    <span className="text-[10px] text-slate-400 leading-tight">Click or paste</span>
                  </>
                )}
              </div>
            )}
            <input
              ref={el => (fileInputRefs.current[index] = el)}
              type="file"
              accept="image/*"
              onChange={e => handleFileInputChange(index, e)}
              className="hidden"
            />
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
    </div>
  );
}

const DESTINATION_OPTIONS_BASE = [
  { key: 'header', label: 'Shipment Details' },
  { key: 'production', label: 'During Production Check' },
  { key: 'packing', label: 'During Packing / Before Stuffing Check' },
  { key: 'stuffing', label: 'During Stuffing Check' },
  { key: 'cooking', label: 'Cooking Test' },
];

function ScanView({ setSections, setHeader }) {
  const [mode, setMode] = useState('image');
  const [imageData, setImageData] = useState(null);
  const [textInput, setTextInput] = useState('');
  const [destination, setDestination] = useState('header');
  const [productionBlockId, setProductionBlockId] = useState(null);
  const [productionBlocks, setProductionBlocks] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [headerResult, setHeaderResult] = useState(null);
  const [added, setAdded] = useState(0);
  const fileInputRef = useRef(null);
  const isHeaderMode = destination === 'header';
  const isProductionMode = destination === 'production';

  useEffect(() => {
    setSections(s => {
      setProductionBlocks(s.production.map(b => ({ id: b.id, process: b.process })));
      if (!productionBlockId && s.production.length) setProductionBlockId(s.production[0].id);
      return s;
    });
  }, []);

  const loadImageFile = async (file) => {
    if (!file) return;
    setError('');
    setRows([]);
    setAdded(0);
    try {
      const dataUrl = await resizeImage(file, 1400, 0.9);
      const match = dataUrl.match(/^data:(.*);base64,(.*)$/);
      if (!match) throw new Error('bad format');
      setImageData({ mediaType: match[1], base64: match[2], previewUrl: dataUrl });
    } catch (err) {
      setError('Could not read that image. Try a different file.');
    }
  };

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    loadImageFile(file);
  };

  const handlePasteCapture = (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          loadImageFile(file);
          e.preventDefault();
          return;
        }
      }
    }
  };

  useEffect(() => {
    if (mode !== 'image') return;
    const handler = (e) => handlePasteCapture(e);
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [mode]);

  const extractFromImage = async () => {
    if (!imageData) return;
    setExtracting(true);
    setError('');
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.base64 } },
              { type: 'text', text: isHeaderMode ? IMAGE_HEADER_PROMPT : IMAGE_PROMPT }
            ]
          }]
        })
      });
      const data = await response.json();
      if (isHeaderMode) {
        const parsedHeader = parseHeaderFromResponse(data);
        setHeaderResult(parsedHeader);
        const anyFilled = Object.values(parsedHeader).some(v => v);
        if (!anyFilled) setError('No shipment details were detected in this image.');
      } else {
        const parsedRows = parseRowsFromResponse(data);
        setRows(parsedRows);
        if (parsedRows.length === 0) setError('No rows were detected in this image.');
      }
    } catch (err) {
      setError(`Could not read data from this image. Try a clearer photo, or use Paste Text instead.`);
    } finally {
      setExtracting(false);
    }
  };

  const extractFromText = async () => {
    if (!textInput.trim()) return;
    setExtracting(true);
    setError('');
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: (isHeaderMode ? TEXT_HEADER_PREFIX : TEXT_PROMPT_PREFIX) + textInput }]
        })
      });
      const data = await response.json();
      if (isHeaderMode) {
        const parsedHeader = parseHeaderFromResponse(data);
        setHeaderResult(parsedHeader);
        const anyFilled = Object.values(parsedHeader).some(v => v);
        if (!anyFilled) setError('No shipment details were detected in that text.');
      } else {
        const parsedRows = parseRowsFromResponse(data);
        setRows(parsedRows);
        if (parsedRows.length === 0) setError('No rows were detected in that text.');
      }
    } catch (err) {
      setError('Could not parse that text. Try reformatting it, or enter values manually.');
    } finally {
      setExtracting(false);
    }
  };

  const updateExtracted = (id, field, value) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r));
  };
  const toggleInclude = (id) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, include: !r.include } : r));
  };
  const updateHeaderResult = (field, value) => {
    setHeaderResult(h => ({ ...h, [field]: value }));
  };

  const addToRecord = () => {
    const toAdd = rows.filter(r => r.include).map(r => ({ id: newId(), date: r.date, time: r.time, result: r.result, resultUnit: r.resultUnit, analysisBy: r.analysisBy }));
    if (toAdd.length === 0) return;
    if (isProductionMode) {
      setSections(s => ({
        ...s,
        production: s.production.map(b => b.id === productionBlockId ? { ...b, rows: [...b.rows, ...toAdd] } : b),
      }));
    } else {
      setSections(s => ({ ...s, [destination]: [...s[destination], ...toAdd] }));
    }
    setAdded(toAdd.length);
    setRows([]);
    setImageData(null);
    setTextInput('');
  };

  const applyHeaderResult = () => {
    if (!headerResult) return;
    setHeader(h => {
      const next = { ...h };
      Object.entries(headerResult).forEach(([k, v]) => {
        if (v) next[k] = v;
      });
      return next;
    });
    setAdded(1);
    setHeaderResult(null);
    setImageData(null);
    setTextInput('');
  };

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setRows([]);
    setHeaderResult(null);
    setAdded(0);
  };

  const switchDestination = (key) => {
    setDestination(key);
    setError('');
    setRows([]);
    setHeaderResult(null);
    setAdded(0);
  };

  let destinationLabel = 'Shipment Details';
  if (destination === 'packing') destinationLabel = 'During Packing / Before Stuffing Check';
  else if (destination === 'stuffing') destinationLabel = 'During Stuffing Check';
  else if (destination === 'cooking') destinationLabel = 'Cooking Test';
  else if (isProductionMode) {
    const block = productionBlocks.find(b => b.id === productionBlockId);
    destinationLabel = block ? `Production Check – ${block.process}` : 'Production Check';
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="font-semibold text-slate-700 mb-1">Scan or Paste Data</h2>
        <p className="text-xs text-slate-500 mb-4">Bring in rows from a photo/screenshot, or paste raw text (e.g. from WhatsApp or Excel). I'll try to read out the Date, Time, Result, and Analysis By for each row — you can review and edit before adding them.</p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => switchMode('image')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border ${mode === 'image' ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            <Camera className="w-4 h-4" /> Scan Image
          </button>
          <button
            onClick={() => switchMode('text')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border ${mode === 'text' ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            <FileText className="w-4 h-4" /> Paste Text
          </button>
        </div>

        <div className="flex flex-wrap gap-4 mb-4">
          <div className="max-w-sm">
            <label className="block text-xs font-medium text-slate-500 mb-1">Add result to</label>
            <select value={destination} onChange={e => switchDestination(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {DESTINATION_OPTIONS_BASE.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
            </select>
          </div>
          {isProductionMode && (
            <div className="max-w-sm">
              <label className="block text-xs font-medium text-slate-500 mb-1">Which process block</label>
              <select value={productionBlockId || ''} onChange={e => setProductionBlockId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {productionBlocks.map(b => <option key={b.id} value={b.id}>{b.process}</option>)}
              </select>
            </div>
          )}
        </div>

        {mode === 'image' ? (
          <>
            <div
              tabIndex={0}
              onPaste={handlePasteCapture}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 mb-4"
            >
              <Clipboard className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Click here and press <span className="font-medium">Ctrl+V</span> to paste a screenshot, or click to choose a file</p>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
            </div>

            {imageData && (
              <div className="mb-4">
                <img src={imageData.previewUrl} alt="Upload preview" className="max-h-64 rounded-lg border border-slate-200" />
              </div>
            )}

            <button
              onClick={extractFromImage}
              disabled={!imageData || extracting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {extracting ? 'Reading image…' : 'Extract Data'}
            </button>
          </>
        ) : (
          <>
            <textarea
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder={isHeaderMode
                ? 'Paste shipment/invoice details here, e.g.\nInvoice No: INV-2026-014\nCustomer: ABC Traders\nProduct: Cumin Seeds\nSupplier: XYZ Farms'
                : 'Paste rows of data here, e.g.\n12/06/2026  10:30  5.2  Raj\n12/06/2026  14:00  4.8  Priya'}
              className="w-full h-36 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
            />
            <button
              onClick={extractFromText}
              disabled={!textInput.trim() || extracting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {extracting ? 'Parsing text…' : 'Extract Data'}
            </button>
          </>
        )}

        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        {added > 0 && rows.length === 0 && !headerResult && !error && (
          <p className="text-sm text-emerald-600 mt-3">
            {isHeaderMode ? 'Shipment details applied to the Record Entry tab.' : `Added ${added} row${added > 1 ? 's' : ''} to "${destinationLabel}". Check the Record Entry tab to review.`}
          </p>
        )}
      </div>

      {headerResult && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="font-semibold text-slate-700 mb-1">Review extracted shipment details</h3>
          <p className="text-xs text-slate-500 mb-4">Fix anything that was misread, then apply to the Shipment Details form. Blank fields here won't overwrite anything already filled in.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {HEADER_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-slate-500 mb-1">{f.label}</label>
                <input
                  value={headerResult[f.key] || ''}
                  onChange={e => updateHeaderResult(f.key, e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder={f.placeholder || f.label}
                />
              </div>
            ))}
          </div>
          <button onClick={applyHeaderResult} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
            <Plus className="w-4 h-4" /> Apply to Shipment Details
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="font-semibold text-slate-700 mb-1">Review extracted rows</h3>
          <p className="text-xs text-slate-500 mb-3">Uncheck any rows you don't want, fix anything that was misread, then add to "{destinationLabel}".</p>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-2 w-10"></th>
                  <th className="py-2 px-2">Date</th>
                  <th className="py-2 px-2">Time</th>
                  <th className="py-2 px-2">Result</th>
                  <th className="py-2 px-2">Unit</th>
                  <th className="py-2 px-2">Analysis By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 px-2 text-center">
                      <input type="checkbox" checked={r.include} onChange={() => toggleInclude(r.id)} />
                    </td>
                    <td className="py-1.5 px-2">
                      <input value={r.date} onChange={e => updateExtracted(r.id, 'date', e.target.value)} placeholder="DD/MM/YYYY" className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </td>
                    <td className="py-1.5 px-2">
                      <input value={r.time} onChange={e => updateExtracted(r.id, 'time', e.target.value)} placeholder="HH:MM" className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </td>
                    <td className="py-1.5 px-2">
                      <input value={r.result} onChange={e => updateExtracted(r.id, 'result', e.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </td>
                    <td className="py-1.5 px-2">
                      <input value={r.resultUnit} onChange={e => updateExtracted(r.id, 'resultUnit', e.target.value)} placeholder="unit" className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </td>
                    <td className="py-1.5 px-2">
                      <input value={r.analysisBy} onChange={e => updateExtracted(r.id, 'analysisBy', e.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addToRecord} className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
            <Plus className="w-4 h-4" /> Add Checked Rows to "{destinationLabel}"
          </button>
        </div>
      )}
    </div>
  );
}