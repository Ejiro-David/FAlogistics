'use strict';

const STORE_URL = 'https://fastaccs.com/FAlogistics/';
const RESULTS_LIMIT = 60;
const EM_DASH = '\u2014';

let allProducts = [];

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function parseCSV(text) {
  const products = [];

  const rows = [];
  let currentRow = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      inQuotes = !inQuotes;
      currentRow += char;
    } else if (char === '\n' && !inQuotes) {
      if (currentRow.trim()) rows.push(currentRow);
      currentRow = '';
    } else if (char === '\r' && nextChar === '\n' && !inQuotes) {
      if (currentRow.trim()) rows.push(currentRow);
      currentRow = '';
      i++;
    } else {
      currentRow += char;
    }
  }
  if (currentRow.trim()) rows.push(currentRow);

  const headerRow = rows[0] || '';
  const headerFields = parseCSVRow(headerRow);
  const sameDayColIdx = headerFields.findIndex(h => h.toLowerCase().trim() === 'sameday');

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const fields = parseCSVRow(rows[rowIndex]);
    const cleanFields = fields.map(f => f.replace(/^"(.*)"{1}$/, '$1').trim());

    if (cleanFields.length >= 2 && cleanFields[0]) {
      const [prodId, name, description, finalPrice, variantsPrices, imageUrl] = cleanFields;
      const variants = parseVariants(variantsPrices || '');

      let displayPrice = (finalPrice || '').trim();
      let displayPriceValue = parsePriceValue(displayPrice);

      if (!displayPrice && variants.length > 0) {
        const sorted = [...variants].sort((a, b) => a.priceValue - b.priceValue);
        displayPrice = sorted[0].price;
        displayPriceValue = sorted[0].priceValue;
      }

      if (!displayPrice) continue;

      let isSameDay = false;
      if (sameDayColIdx >= 0 && cleanFields[sameDayColIdx]) {
        isSameDay = cleanFields[sameDayColIdx].toLowerCase() === 'true';
      }

      products.push({
        productId: prodId || '',
        name: name ? name.replace(/\n/g, ' ').trim() : '',
        description: description ? description.replace(/\n/g, ' ').trim() : '',
        price: displayPrice,
        priceValue: displayPriceValue,
        variants: variants,
        imageUrl: imageUrl || '',
        sameDay: isSameDay
      });
    }
  }

  return products;
}

function parseCSVRow(row) {
  const fields = [];
  let currentField = '';
  let inQuotes = false;

  for (let j = 0; j < row.length; j++) {
    const char = row[j];
    if (char === '"' && row[j + 1] === '"') {
      currentField += '"';
      j++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField.trim());
      currentField = '';
    } else {
      currentField += char;
    }
  }
  fields.push(currentField.trim());
  return fields;
}

function parseVariants(variantsStr) {
  if (!variantsStr || variantsStr.trim() === '') return [];
  const variants = [];
  const parts = variantsStr.split('|');
  for (const part of parts) {
    const match = part.match(new RegExp(`(.+?)\\s*${EM_DASH}\\s*(.+)`));
    if (match) {
      variants.push({
        name: match[1].trim(),
        price: match[2].trim(),
        priceValue: parsePriceValue(match[2])
      });
    }
  }
  return variants;
}

function parsePriceValue(priceStr) {
  const digits = String(priceStr || '').replace(/[^\d]/g, '');
  return parseInt(digits, 10) || 0;
}

function setStatus(message) {
  const status = document.getElementById('staffStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.timer && clearTimeout(Number(status.dataset.timer));
  const timer = setTimeout(() => { status.textContent = ''; }, 2000);
  status.dataset.timer = String(timer);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

function scoreProduct(product, term) {
  const t = term.toLowerCase();
  const pid = product.productId.toLowerCase();
  const name = product.name.toLowerCase();
  const desc = product.description.toLowerCase();

  if (pid === t) return 100;
  let score = 0;
  if (pid.includes(t)) score += 70;
  if (name.includes(t)) score += 30;
  if (desc.includes(t)) score += 10;
  return score;
}

function renderResults(results, totalMatches) {
  const grid = document.getElementById('staffResultsGrid');
  const empty = document.getElementById('staffEmpty');
  const count = document.getElementById('staffResultsCount');

  if (!grid || !count || !empty) return;

  if (results.length === 0) {
    grid.innerHTML = '';
    empty.style.display = totalMatches === 0 ? 'block' : 'none';
    count.textContent = totalMatches === 0 ? 'No matches' : `Showing 0 of ${totalMatches}`;
    return;
  }

  empty.style.display = 'none';
  count.textContent = `Showing ${results.length} of ${totalMatches}`;

  const html = results.map(product => {
    const priceDisplay = product.variants.length > 0 ? `From ${product.price}` : product.price;
    const link = `${STORE_URL}?product=${encodeURIComponent(product.productId)}`;
    const variantsHtml = product.variants.length > 0
      ? `<details class="staff-variants"><summary>Options (${product.variants.length})</summary>${product.variants.map(v => `<div class="staff-variant">${escapeHtml(v.name)} - ${escapeHtml(v.price)}</div>`).join('')}</details>`
      : '';

    const imageContent = product.imageUrl
      ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">`
      : `<div class="staff-image-fallback">No Image</div>`;

    return `
      <div class="staff-card"
           data-product-id="${escapeHtml(product.productId)}"
           data-name="${escapeHtml(product.name)}"
           data-price="${escapeHtml(priceDisplay)}"
           data-image="${escapeHtml(product.imageUrl || '')}"
           data-link="${escapeHtml(link)}">
        <div class="staff-image">
          ${product.sameDay ? '<div class="staff-badge">Same Day</div>' : ''}
          ${imageContent}
        </div>
        <div class="staff-info">
          <div class="staff-name">${escapeHtml(product.name)}</div>
          <div class="staff-id">ID: ${escapeHtml(product.productId)}</div>
          <div class="staff-price">${escapeHtml(priceDisplay)}</div>
          <div class="staff-actions">
            <button class="staff-btn" type="button" data-action="copy-link">Copy Link</button>
            <button class="staff-btn" type="button" data-action="open-link">Open Product</button>
            <button class="staff-btn" type="button" data-action="copy-summary">Copy Summary</button>
            <button class="staff-btn" type="button" data-action="copy-image">Copy Image URL</button>
          </div>
          ${variantsHtml}
        </div>
      </div>
    `;
  }).join('');

  grid.innerHTML = html;
}

function handleActionClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.staff-card');
  if (!card) return;

  const action = btn.dataset.action;
  const productId = card.dataset.productId || '';
  const name = card.dataset.name || '';
  const price = card.dataset.price || '';
  const link = card.dataset.link || '';
  const image = card.dataset.image || '';

  if (action === 'open-link' && link) {
    window.open(link, '_blank', 'noopener,noreferrer');
    return;
  }

  if (action === 'copy-link' && link) {
    copyText(link).then(() => setStatus('Link copied'));
    return;
  }

  if (action === 'copy-image') {
    if (!image) {
      setStatus('No image URL available');
      return;
    }
    copyText(image).then(() => setStatus('Image URL copied'));
    return;
  }

  if (action === 'copy-summary') {
    const summary = [
      `Product: ${name}`,
      `ID: ${productId}`,
      `Price: ${price}`,
      `Link: ${link}`,
      image ? `Image: ${image}` : ''
    ].filter(Boolean).join('\n');
    copyText(summary).then(() => setStatus('Summary copied'));
  }
}

function handleSearchInput() {
  const input = document.getElementById('staffSearch');
  if (!input) return;
  const term = input.value.trim();

  if (!term) {
    const grid = document.getElementById('staffResultsGrid');
    const empty = document.getElementById('staffEmpty');
    const count = document.getElementById('staffResultsCount');
    if (grid) grid.innerHTML = '';
    if (empty) empty.style.display = 'none';
    if (count) count.textContent = 'Type to search';
    return;
  }

  const scored = allProducts
    .map(product => ({ product, score: scoreProduct(product, term) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const totalMatches = scored.length;
  const results = scored.slice(0, RESULTS_LIMIT).map(item => item.product);
  renderResults(results, totalMatches);
}

async function loadProducts() {
  const count = document.getElementById('staffResultsCount');
  if (count) count.textContent = 'Loading products...';
  try {
    const response = await fetch('../products.csv', { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    allProducts = parseCSV(csvText);
    handleSearchInput();
  } catch (error) {
    if (count) count.textContent = 'Unable to load products';
  }
}

const resultsGrid = document.getElementById('staffResultsGrid');
if (resultsGrid) resultsGrid.addEventListener('click', handleActionClick);

const searchInput = document.getElementById('staffSearch');
if (searchInput) searchInput.addEventListener('input', handleSearchInput);

const clearBtn = document.getElementById('staffClear');
if (clearBtn) clearBtn.addEventListener('click', () => {
  const input = document.getElementById('staffSearch');
  if (!input) return;
  input.value = '';
  input.focus();
  handleSearchInput();
});

loadProducts();
