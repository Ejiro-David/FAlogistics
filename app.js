// =========================================================
//  FA LOGISTICS — App Logic
//  Features: CSV loading, search, filters, cart with qty,
//            checkout via WhatsApp, infinite scroll,
//            shareable links, URL-persisted filters
// =========================================================

'use strict';

// ── Constants ──
const WHATSAPP_NUMBER = '2347066399871';
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;

// ── Global State ──
let allProducts = [];
let filteredProducts = [];
let selectedProduct = null;
let selectedVariant = null;
let cart = [];
let displayedCount = 0;

// ── Cart Persistence ──
try {
  const savedCart = localStorage.getItem('faLogisticsCart');
  if (savedCart) {
    cart = JSON.parse(savedCart);
    updateCartUI();
  }
} catch(e) { /* silently fail */ }

// =========================================================
//  DATA LOADING & PARSING
// =========================================================

async function loadProducts(retryCount = 0) {
  const grid = document.getElementById('productsGrid');

  try {
    grid.innerHTML = '<div class="loading" role="status" aria-live="polite">Loading products…</div>';

    const response = await fetch(`products.csv?v=${Date.now()}`, { cache: 'no-store' });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const csvText = await response.text();
    allProducts = parseCSV(csvText);
    allProducts = prioritizeProducts(allProducts);

    filteredProducts = [...allProducts];

    // Restore filters from URL before first render
    restoreFiltersFromURL();

    renderProducts();
    updateResultsCount();
    checkProductUrlParam();
  } catch (error) {
    console.error('Error loading products:', error);

    if (retryCount < MAX_RETRIES) {
      // Auto-retry with back-off
      const delay = (retryCount + 1) * 2000;
      grid.innerHTML = `<div class="loading" role="status" aria-live="polite">Loading failed — retrying in ${delay / 1000}s…</div>`;
      setTimeout(() => loadProducts(retryCount + 1), delay);
    } else {
      // Show error state with retry button
      grid.innerHTML = '';
      grid.style.display = 'none';
      const main = document.querySelector('.main');
      let errorEl = document.getElementById('errorState');
      if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = 'errorState';
        errorEl.className = 'error-state';
        errorEl.setAttribute('role', 'alert');
        main.appendChild(errorEl);
      }
      errorEl.style.display = 'block';
      errorEl.innerHTML = `
        <div class="error-icon">⚠️</div>
        <div class="error-text">Unable to load products. Please check your connection and try again.</div>
        <button class="retry-btn" onclick="document.getElementById('errorState').style.display='none'; document.getElementById('productsGrid').style.display='grid'; loadProducts(0);">Try Again</button>
      `;
    }
  }
}

function prioritizeProducts(products) {
  const featuredIds = ['PROD-1487', 'PROD-1488'];
  const priorityKeywords = ['flower', 'rose', 'bouquet', 'pizza', 'drink', 'beverage', 'chicken', 'ring', 'engagement', 'wedding', 'document', 'certificate', 'processing'];
  const featuredMap = new Map();

  products.forEach(product => {
    if (featuredIds.includes(product.productId)) {
      featuredMap.set(product.productId, product);
    }
  });

  const remaining = products.filter(product => !featuredMap.has(product.productId));
  const priority = [];
  const other = [];

  remaining.forEach(product => {
    const text = (product.name + ' ' + product.description).toLowerCase();
    if (priorityKeywords.some(kw => text.includes(kw))) {
      priority.push(product);
    } else {
      other.push(product);
    }
  });

  const prioritized = [...priority, ...other];
  const firstFeatured = featuredMap.get(featuredIds[0]);
  const secondFeatured = featuredMap.get(featuredIds[1]);

  if (firstFeatured && secondFeatured) {
    const splitIndex = Math.min(10, prioritized.length);
    return [
      firstFeatured,
      ...prioritized.slice(0, splitIndex),
      secondFeatured,
      ...prioritized.slice(splitIndex)
    ];
  }

  if (firstFeatured) return [firstFeatured, ...prioritized];
  if (secondFeatured) return [secondFeatured, ...prioritized];
  return prioritized;
}

// Parse CSV with proper handling of quotes, commas, and newlines
function parseCSV(text) {
  const products = [];
  let productId = 1;

  // Split into rows handling quoted fields properly
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

  // Detect header columns
  const headerRow = rows[0] || '';
  const headerFields = parseCSVRow(headerRow);
  const sameDayColIdx = headerFields.findIndex(h => h.toLowerCase().trim() === 'sameday');

  // Parse each row (skip header)
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

      const descClean = description && description !== 'No description' ? description.replace(/\n/g, ' ').trim() : '';

      // Determine sameDay strictly from CSV column (no guessing)
      let isSameDay = false;
      if (sameDayColIdx >= 0 && cleanFields[sameDayColIdx]) {
        isSameDay = cleanFields[sameDayColIdx].toLowerCase() === 'true';
      }

      products.push({
        id: productId++,
        productId: prodId || '',
        name: name ? name.replace(/\n/g, ' ').trim() : '',
        description: descClean,
        price: displayPrice,
        priceValue: displayPriceValue,
        variants: variants,
        category: categorizeProduct(name || ''),
        emoji: getProductEmoji(name || ''),
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
    const match = part.match(/(.+?)\s*—\s*(₦[\d,]+)/);
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
  return parseInt(priceStr.replace(/[₦,]/g, '')) || 0;
}

// =========================================================
//  PRODUCT CATEGORIZATION & ICONS
// =========================================================

function categorizeProduct(name) {
  const n = name.toLowerCase();
  if (/ring|necklace|earring|bracelet|jewelry|jewel/i.test(n)) return 'Jewelry';
  if (/teddy|bear|plush|stuffed/i.test(n)) return 'Teddy Bears';
  if (/rose|flower|bouquet|soap flower/i.test(n)) return 'Flowers';
  if (/gift basket|gift box|gift set|gift hamper/i.test(n)) return 'Gift Baskets';
  if (/pizza|burger|chicken|sandwich|pasta|italian|asian|quesadilla|pie|sesame/i.test(n)) return 'Food';
  if (/cake.*wine|cake.*champagne|wine.*cake|wine.*roses/i.test(n)) return 'Wine & Treats';
  if (/custom|personalized|photo|print|mug|blanket|t-shirt|hoodie|card/i.test(n)) return 'Custom Items';
  if (/christmas|xmas|santa|tree/i.test(n)) return 'Christmas';
  if (/watch|wristwatch/i.test(n)) return 'Watches';
  if (/key fob|remote|tesla|bmw|mercedes/i.test(n)) return 'Car Keys';
  if (/military|army|camo|uniform/i.test(n)) return 'Military';
  if (/underwear|boxer|brief/i.test(n)) return 'Underwear';
  if (/wine|chocolate|ferrero|champagne/i.test(n)) return 'Wine & Treats';
  return 'Other';
}

function getProductEmoji(name) {
  const n = name.toLowerCase();
  if (/ring/i.test(n)) return '💍';
  if (/necklace/i.test(n)) return '📿';
  if (/earring/i.test(n)) return '👂';
  if (/watch/i.test(n)) return '⌚';
  if (/teddy|bear/i.test(n)) return '🧸';
  if (/rose|flower/i.test(n)) return '🌹';
  if (/gift|basket/i.test(n)) return '🎁';
  if (/pizza/i.test(n)) return '🍕';
  if (/burger/i.test(n)) return '🍔';
  if (/chicken/i.test(n)) return '🍗';
  if (/christmas|xmas|santa/i.test(n)) return '🎄';
  if (/chocolate/i.test(n)) return '🍫';
  if (/wine/i.test(n)) return '🍷';
  if (/mug|cup/i.test(n)) return '☕';
  if (/photo|picture/i.test(n)) return '📸';
  if (/card/i.test(n)) return '💌';
  if (/quesadilla/i.test(n)) return '🌮';
  if (/pie/i.test(n)) return '🥧';
  if (/sesame/i.test(n)) return '🍛';
  if (/cake/i.test(n)) return '🎂';
  if (/key/i.test(n)) return '🔑';
  return '📦';
}

// =========================================================
//  RENDERING
// =========================================================

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  const sentinel = document.getElementById('loadMoreSentinel');

  if (filteredProducts.length === 0) {
    grid.style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    if (sentinel) sentinel.style.display = 'none';
    return;
  }

  grid.style.display = 'grid';
  document.getElementById('emptyState').style.display = 'none';
  displayedCount = 0;
  grid.innerHTML = '';
  loadMoreProducts();
}

function generateCardHTML(product) {
  const hasVariants = product.variants.length > 0;
  const priceDisplay = hasVariants ? `From ${product.price}` : product.price;
  const variantInfo = hasVariants ? `${product.variants.length} options available` : '';
  const badge = getProductBadge(product);
  const deliveryBadge = product.sameDay ? '<div class="product-badge delivery">⚡ Same Day</div>' : '';

  const imageContent = product.imageUrl
    ? `<img src="${product.imageUrl}" alt="${product.name}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'; this.parentElement.innerHTML='<span>${product.emoji}</span>';">`
    : `<span>${product.emoji}</span>`;

  return `
    <div class="product-card" data-product-id="${product.id}" role="article" aria-label="${product.name}, ${priceDisplay}">
      <div class="product-image">
        ${badge}
        ${deliveryBadge}
        ${imageContent}
      </div>
      <div class="product-info">
        <div class="product-name">${product.name}</div>
        <div class="product-price">${priceDisplay}</div>
        ${variantInfo ? `<div class="product-variants">${variantInfo}</div>` : ''}
        <button class="order-btn" aria-label="Add ${product.name} to cart">Add to Cart</button>
      </div>
    </div>
  `;
}

function loadMoreProducts() {
  const grid = document.getElementById('productsGrid');
  const sentinel = document.getElementById('loadMoreSentinel');
  const start = displayedCount;
  const end = Math.min(start + BATCH_SIZE, filteredProducts.length);

  if (start >= filteredProducts.length) {
    if (sentinel) sentinel.style.display = 'none';
    return;
  }

  const batch = filteredProducts.slice(start, end);
  grid.insertAdjacentHTML('beforeend', batch.map(generateCardHTML).join(''));

  const newCards = grid.querySelectorAll('.product-card:not([data-bound])');
  newCards.forEach(card => {
    card.setAttribute('data-bound', 'true');
    card.querySelector('.order-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      handleAddToCart(parseInt(card.dataset.productId));
    });
    card.addEventListener('click', () => {
      showProductDetail(parseInt(card.dataset.productId));
    });
  });

  displayedCount = end;

  if (sentinel) {
    if (displayedCount < filteredProducts.length) {
      sentinel.style.display = 'block';
      sentinel.textContent = `Showing ${displayedCount} of ${filteredProducts.length} — scroll for more`;
    } else {
      sentinel.style.display = 'none';
    }
  }
}

function getProductBadge(product) {
  if (product.priceValue < 50000) return '<div class="product-badge">💰 Budget-Friendly</div>';
  if (product.priceValue >= 50000 && product.priceValue <= 100000) return '<div class="product-badge">⭐ Best Value</div>';
  if (product.priceValue > 150000) return '<div class="product-badge">💎 Premium</div>';
  if (product.category === 'Food') return '<div class="product-badge">🔥 Hot</div>';
  return '';
}

// =========================================================
//  CART — with Quantity Support
// =========================================================

function handleAddToCart(productId) {
  selectedProduct = allProducts.find(p => p.id === productId);
  if (!selectedProduct) return;

  if (selectedProduct.variants.length > 0) {
    showVariantModalForCart();
  } else {
    addToCart(selectedProduct, null);
  }
}

function addToCart(product, variant = null) {
  // Check if same product+variant already in cart → increment qty
  const existingIdx = cart.findIndex(item =>
    item.product.id === product.id &&
    ((!item.variant && !variant) || (item.variant && variant && item.variant.name === variant.name))
  );

  if (existingIdx >= 0) {
    cart[existingIdx].qty += 1;
  } else {
    cart.push({
      id: Date.now(),
      product: product,
      variant: variant,
      price: variant ? variant.price : product.price,
      priceValue: variant ? variant.priceValue : product.priceValue,
      qty: 1
    });
  }

  saveCart();
  updateCartUI();
  hideModal();
  showCartNotification();
}

function updateQty(cartItemId, delta) {
  const item = cart.find(i => i.id === cartItemId);
  if (!item) return;

  item.qty += delta;
  if (item.qty < 1) {
    removeFromCart(cartItemId);
    return;
  }

  saveCart();
  updateCartUI();
  renderCartItems();
}

function removeFromCart(cartItemId) {
  cart = cart.filter(item => item.id !== cartItemId);
  saveCart();
  updateCartUI();
  renderCartItems();
}

function clearCart() {
  cart = [];
  saveCart();
  updateCartUI();
  renderCartItems();
}

function updateCartUI() {
  const cartCount = document.getElementById('cartCount');
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);

  if (totalItems > 0) {
    cartCount.textContent = totalItems;
    cartCount.style.display = 'grid';
  } else {
    cartCount.style.display = 'none';
  }
}

function showCartNotification() {
  const cartIcon = document.getElementById('cartIconBtn');
  if (cartIcon) {
    cartIcon.style.transform = 'scale(1.2)';
    setTimeout(() => { cartIcon.style.transform = 'scale(1)'; }, 200);
  }

  const toast = document.getElementById('cartToast');
  if (!toast) return;
  toast.classList.add('show');
  if (toast.dataset.timer) clearTimeout(Number(toast.dataset.timer));
  const timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 1600);
  toast.dataset.timer = String(timer);
}

function showCartModal() {
  const modal = document.getElementById('cartModal');
  modal.classList.add('active');
  document.body.classList.add('no-scroll');
  trapFocus(modal);
  renderCartItems();
}

function hideCartModal() {
  document.getElementById('cartModal').classList.remove('active');
  document.body.classList.remove('no-scroll');
}

function renderCartItems() {
  const container = document.getElementById('cartItemsContainer');
  const footer = document.getElementById('cartFooter');
  const totalAmount = document.getElementById('cartTotalAmount');

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty" role="status">
        <div class="cart-empty-icon">🛒</div>
        <div class="cart-empty-text">Your cart is empty</div>
      </div>
    `;
    footer.style.display = 'none';
    return;
  }

  footer.style.display = 'block';
  const total = cart.reduce((sum, item) => sum + (item.priceValue * item.qty), 0);
  totalAmount.textContent = `₦${total.toLocaleString()}`;

  container.innerHTML = cart.map(item => {
    const thumbContent = item.product.imageUrl
      ? `<img src="${item.product.imageUrl}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'; this.parentElement.innerHTML='<span>${item.product.emoji}</span>';">`
      : `<span>${item.product.emoji}</span>`;
    return `
    <div class="cart-item">
      <div class="cart-item-thumb">${thumbContent}</div>
      <div class="cart-item-details">
        <div class="cart-item-name">${item.product.name}</div>
        ${item.variant ? `<div class="cart-item-variant">${item.variant.name}</div>` : ''}
        <div class="cart-item-price">${item.price}${item.qty > 1 ? ` × ${item.qty} = ₦${(item.priceValue * item.qty).toLocaleString()}` : ''}</div>
      </div>
      <div class="cart-item-controls">
        <div class="cart-item-qty">
          <button class="qty-btn qty-minus" onclick="updateQty(${item.id}, -1)" aria-label="Decrease quantity">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn qty-plus" onclick="updateQty(${item.id}, 1)" aria-label="Increase quantity">+</button>
        </div>
        <button class="cart-item-remove" onclick="removeFromCart(${item.id})" aria-label="Remove ${item.product.name} from cart">
          ×
        </button>
      </div>
    </div>
  `}).join('');
}

function saveCart() {
  try {
    localStorage.setItem('faLogisticsCart', JSON.stringify(cart));
  } catch(e) { /* silently fail */ }
}

// =========================================================
//  VARIANT MODAL
// =========================================================

function showVariantModalForCart() {
  const modal = document.getElementById('variantModal');
  const modalTitle = document.getElementById('modalProductName');
  const variantList = document.getElementById('variantList');

  modalTitle.textContent = selectedProduct.name;
  document.getElementById('btnOrder').textContent = 'Add to Cart';

  variantList.innerHTML = selectedProduct.variants.map((variant, index) => `
    <div class="variant-option" data-variant-index="${index}" role="option" tabindex="0" aria-selected="false">
      <span class="variant-name">${variant.name}</span>
      <span class="variant-price">${variant.price}</span>
    </div>
  `).join('');

  document.querySelectorAll('.variant-option').forEach(option => {
    const selectHandler = () => {
      document.querySelectorAll('.variant-option').forEach(o => {
        o.classList.remove('selected');
        o.setAttribute('aria-selected', 'false');
      });
      option.classList.add('selected');
      option.setAttribute('aria-selected', 'true');
      selectedVariant = selectedProduct.variants[parseInt(option.dataset.variantIndex)];
    };
    option.addEventListener('click', selectHandler);
    option.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectHandler(); }
    });
  });

  modal.classList.add('active');
  trapFocus(modal);
}

function hideModal() {
  document.getElementById('variantModal').classList.remove('active');
  selectedVariant = null;
}

// =========================================================
//  PRODUCT DETAIL MODAL
// =========================================================

function showProductDetail(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const modal = document.getElementById('detailModal');

  if (product.productId) {
    const url = new URL(window.location);
    url.searchParams.set('product', product.productId);
    history.replaceState(null, '', url);
  }

  document.getElementById('detailImage').innerHTML = product.imageUrl
    ? `<img src="${product.imageUrl}" alt="${product.name}" decoding="async" onerror="this.style.display='none'; this.parentElement.innerHTML='<span>${product.emoji}</span>';">`
    : `<span>${product.emoji}</span>`;

  const badge = getProductBadge(product);
  document.getElementById('detailBadge').innerHTML = badge ? badge.replace('product-badge', 'detail-badge') : '';
  document.getElementById('detailName').textContent = product.name;
  document.getElementById('detailPrice').textContent = product.variants.length > 0 ? `From ${product.price}` : product.price;
  document.getElementById('detailDescription').textContent = product.description || 'No description available.';

  const variantsSection = document.getElementById('detailVariantsSection');
  const variantsList = document.getElementById('detailVariantsList');

  if (product.variants.length > 0) {
    variantsSection.style.display = 'block';
    variantsList.innerHTML = product.variants.map((v, i) => `
      <div class="detail-variant" data-variant-index="${i}" role="option" tabindex="0" aria-selected="false">
        <span class="detail-variant-name">${v.name}</span>
        <span class="detail-variant-price">${v.price}</span>
      </div>
    `).join('');

    variantsList.querySelectorAll('.detail-variant').forEach(v => {
      const selectHandler = () => {
        variantsList.querySelectorAll('.detail-variant').forEach(x => {
          x.classList.remove('selected');
          x.setAttribute('aria-selected', 'false');
        });
        v.classList.add('selected');
        v.setAttribute('aria-selected', 'true');
      };
      v.addEventListener('click', selectHandler);
      v.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectHandler(); }
      });
    });
  } else {
    variantsSection.style.display = 'none';
  }

  modal.dataset.productId = productId;
  modal.classList.add('active');
  document.body.classList.add('no-scroll');
  trapFocus(modal);
}

function hideDetailModal() {
  document.getElementById('detailModal').classList.remove('active');
  document.body.classList.remove('no-scroll');
  const url = new URL(window.location);
  url.searchParams.delete('product');
  history.replaceState(null, '', url);
}

function checkProductUrlParam() {
  const params = new URLSearchParams(window.location.search);
  const prodCode = params.get('product');
  if (!prodCode) return;

  const product = allProducts.find(p => p.productId === prodCode);
  if (product) {
    setTimeout(() => {
      document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => showProductDetail(product.id), 400);
    }, 300);
  }
}

function addToCartFromDetail() {
  const modal = document.getElementById('detailModal');
  const productId = parseInt(modal.dataset.productId);
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  if (product.variants.length > 0) {
    const selectedEl = document.querySelector('#detailVariantsList .detail-variant.selected');
    if (!selectedEl) {
      alert('Please select an option first');
      return;
    }
    addToCart(product, product.variants[parseInt(selectedEl.dataset.variantIndex)]);
  } else {
    addToCart(product, null);
  }

  hideDetailModal();
}

// =========================================================
//  CHECKOUT — WhatsApp with Qty
// =========================================================

function getProductCode(product) {
  return product.productId || `PROD-${String(product.id).padStart(4, '0')}`;
}

function proceedToWhatsApp() {
  if (cart.length === 0) return;
  showCheckoutForm();
}

const LOCATION_DATA = {
  'Nigeria': ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'],
  'United States': ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','Washington D.C.'],
  'United Kingdom': ['England','Scotland','Wales','Northern Ireland','London'],
  'Canada': ['Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador','Nova Scotia','Ontario','Prince Edward Island','Quebec','Saskatchewan'],
  'Ghana': ['Greater Accra','Ashanti','Central','Eastern','Northern','Western','Volta','Upper East','Upper West','Brong-Ahafo'],
  'South Africa': ['Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo','Mpumalanga','North West','Northern Cape','Western Cape'],
  'Germany': ['Baden-Württemberg','Bavaria','Berlin','Brandenburg','Bremen','Hamburg','Hesse','Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia','Rhineland-Palatinate','Saarland','Saxony','Saxony-Anhalt','Schleswig-Holstein','Thuringia'],
  'France': ['Île-de-France','Provence-Alpes-Côte d\'Azur','Auvergne-Rhône-Alpes','Nouvelle-Aquitaine','Occitanie','Hauts-de-France','Grand Est','Pays de la Loire','Brittany','Normandy'],
  'Australia': ['New South Wales','Victoria','Queensland','Western Australia','South Australia','Tasmania','ACT','Northern Territory'],
  'UAE': ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'],
  'India': ['Maharashtra','Delhi','Karnataka','Tamil Nadu','Telangana','Gujarat','West Bengal','Rajasthan','Uttar Pradesh','Kerala'],
  'Ireland': ['Dublin','Cork','Galway','Limerick','Waterford','Kilkenny'],
  'Netherlands': ['North Holland','South Holland','Utrecht','North Brabant','Gelderland','Overijssel'],
  'Italy': ['Lombardy','Lazio','Campania','Veneto','Piedmont','Tuscany','Emilia-Romagna','Sicily'],
  'Spain': ['Madrid','Catalonia','Andalusia','Valencia','Basque Country','Galicia'],
  'Saudi Arabia': ['Riyadh','Makkah','Eastern Province','Madinah','Asir','Qassim'],
  'Kenya': ['Nairobi','Mombasa','Kisumu','Nakuru','Eldoret'],
  'Other Country': []
};

function showCheckoutForm() {
  const overlay = document.getElementById('checkoutOverlay');
  const countrySelect = document.getElementById('checkoutCountry');
  const stateSelect = document.getElementById('checkoutState');

  countrySelect.innerHTML = '<option value="">Select country…</option>';
  Object.keys(LOCATION_DATA).forEach(country => {
    const opt = document.createElement('option');
    opt.value = country;
    opt.textContent = country;
    countrySelect.appendChild(opt);
  });

  stateSelect.innerHTML = '<option value="">Select country first…</option>';
  stateSelect.disabled = true;
  document.getElementById('checkoutCity').value = '';

  overlay.classList.add('active');
  document.body.classList.add('no-scroll');
  trapFocus(overlay);
}

function hideCheckoutForm() {
  document.getElementById('checkoutOverlay').classList.remove('active');
  document.body.classList.remove('no-scroll');
}

function sendToWhatsApp() {
  const country = document.getElementById('checkoutCountry').value;
  const state = document.getElementById('checkoutState').value;
  const city = document.getElementById('checkoutCity').value.trim();

  if (!country) {
    document.getElementById('checkoutCountry').focus();
    return;
  }

  let message = `ORDER SUMMARY\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  cart.forEach((item, index) => {
    const code = getProductCode(item.product);
    const qtyStr = item.qty > 1 ? ` ×${item.qty}` : '';
    const lineTotal = item.qty > 1 ? ` = ₦${(item.priceValue * item.qty).toLocaleString()}` : '';
    message += `${index + 1}. ${code} — ${item.price}${qtyStr}${lineTotal}\n`;
    if (item.variant) {
      message += `   ↳ ${item.variant.name}\n`;
    }
  });

  const total = cart.reduce((sum, item) => sum + (item.priceValue * item.qty), 0);
  message += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `TOTAL: ₦${total.toLocaleString()}\n\n`;

  let location = `📍 ${country}`;
  if (state) location += `, ${state}`;
  if (city) location += `, ${city}`;
  message += `${location}\n\n`;

  message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `Prices may vary by destination.\n\nWe'll confirm final pricing & delivery time.\n\n— FA Logistics`;

  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank');
  hideCheckoutForm();
  hideCartModal();
}

// =========================================================
//  SEARCH & FILTERS (with URL persistence)
// =========================================================

function fuzzyMatch(str, pattern) {
  const strLower = str.toLowerCase();
  const patternLower = pattern.toLowerCase();
  if (strLower.includes(patternLower)) return 2;
  const words = strLower.split(/\s+/);
  if (words.some(word => word.startsWith(patternLower))) return 1.5;
  // Subsequence fallback is useful for very short typos; disable for longer terms
  // to avoid broad unrelated matches.
  if (patternLower.length >= 4) return 0;
  let patternIdx = 0;
  for (let i = 0; i < strLower.length && patternIdx < patternLower.length; i++) {
    if (strLower[i] === patternLower[patternIdx]) patternIdx++;
  }
  if (patternIdx === patternLower.length) return 0.5;
  return 0;
}

function performSearch(searchTerm) {
  if (searchTerm === '') {
    filteredProducts = [...allProducts];
  } else {
    filteredProducts = allProducts
      .map(product => {
        const nameScore = fuzzyMatch(product.name, searchTerm);
        const descScore = fuzzyMatch(product.description, searchTerm) * 0.7;
        const categoryScore = fuzzyMatch(product.category, searchTerm) * 0.5;
        const variantsScore = product.variants
          .map(v => fuzzyMatch(v.name, searchTerm))
          .reduce((max, score) => Math.max(max, score), 0) * 0.6;
        return { product, score: nameScore + descScore + categoryScore + variantsScore };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.product);
  }
}

function applyCurrentFilters() {
  const activeFilter = document.querySelector('.filter-pill.active')?.dataset.filter || 'all';
  const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();

  let products = searchTerm === '' ? [...allProducts] : [...filteredProducts];

  if (activeFilter !== 'all') {
    products = products.filter(product => {
      switch(activeFilter) {
        case 'hot': return product.category === 'Food' || product.category === 'Flowers' || product.category === 'Teddy Bears';
        case 'under50k': return product.priceValue > 0 && product.priceValue < 50000;
        case 'budget-friendly': return product.priceValue > 0 && product.priceValue <= 60000;
        case 'best-value': return product.priceValue >= 50000 && product.priceValue <= 90000;
        case 'under100k': return product.priceValue > 0 && product.priceValue < 100000;
        case 'same-day': return product.sameDay === true;
        case 'premium': return product.priceValue >= 120000;
        default: return true;
      }
    });
  }

  filteredProducts = products;
}

function filterByCategory(category) {
  const categoryFilters = {
    'valentine': ['valentine', 'love', 'heart', 'romance', 'rose', 'cupid'],
    'birthday': ['birthday', 'celebration', 'party', 'gift', 'cake'],
    'anniversary': ['anniversary', 'wedding', 'engagement', 'ring', 'couple'],
    'holiday': ['christmas', 'holiday', 'santa', 'festive', 'seasonal'],
    'jewelry': ['ring', 'necklace', 'bracelet', 'earring', 'silver', 'gold', 'jewelry', 'pendant'],
    'watches': ['watch', 'timepiece'],
    'plush': ['teddy', 'bear', 'plush', 'stuffed', 'toy'],
    'home': ['mug', 'basket', 'cup', 'home', 'decor'],
    'fashion': ['pants', 'clothing', 'apparel', 'fashion', 'wear'],
    'beauty': ['beauty', 'skincare', 'cosmetic'],
    'for-her': ['women', 'woman', 'her', 'ladies', 'female'],
    'for-him': ['men', 'man', 'male', 'mens'],
    'couples': ['couple', 'pair', 'his and hers'],
    'trending': [],
    'bundles': ['set', 'bundle', 'pack', 'collection']
  };

  const keywords = categoryFilters[category] || [];

  if (category === 'trending') {
    filteredProducts = allProducts.filter(p => p.priceValue > 40000 && p.priceValue < 100000).slice(0, 50);
  } else {
    filteredProducts = allProducts.filter(product => {
      const text = `${product.name} ${product.description}`.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });
  }

  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  document.getElementById('categoriesToggle').classList.add('active');

  renderProducts();
  updateResultsCount();
  persistFiltersToURL();
}

function updateResultsCount() {
  // results bar removed
}

// ── URL Persistence for Filters ──
function persistFiltersToURL() {
  const url = new URL(window.location);
  const activeFilter = document.querySelector('.filter-pill.active')?.dataset.filter || 'all';
  const searchTerm = document.getElementById('searchInput').value.trim();
  const activeCategory = document.querySelector('.category-pill.active')?.dataset.category || '';

  if (activeFilter !== 'all') {
    url.searchParams.set('filter', activeFilter);
  } else {
    url.searchParams.delete('filter');
  }

  if (searchTerm) {
    url.searchParams.set('q', searchTerm);
  } else {
    url.searchParams.delete('q');
  }

  if (activeCategory) {
    url.searchParams.set('category', activeCategory);
  } else {
    url.searchParams.delete('category');
  }

  history.replaceState(null, '', url);
}

function restoreFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  const filter = params.get('filter');
  const search = params.get('q');
  const category = params.get('category');

  if (search) {
    document.getElementById('searchInput').value = search;
    document.getElementById('searchClear').classList.add('visible');
    performSearch(search.toLowerCase().trim());
  }

  if (filter && filter !== 'all') {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    const pill = document.querySelector(`.filter-pill[data-filter="${filter}"]`);
    if (pill) {
      pill.classList.add('active');
      applyCurrentFilters();
    }
  }

  if (category) {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    document.getElementById('categoriesToggle').classList.add('active');
    document.getElementById('categoryPillsSection').classList.add('show');
    const pill = document.querySelector(`.category-pill[data-category="${category}"]`);
    if (pill) {
      pill.classList.add('active');
      filterByCategory(category);
    }
  }
}

// =========================================================
//  ACCESSIBILITY — Focus Trapping & Keyboard
// =========================================================

function trapFocus(container) {
  const focusable = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  // Remove old trap if any
  container._trapHandler && container.removeEventListener('keydown', container._trapHandler);

  container._trapHandler = function(e) {
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    if (e.key === 'Escape') {
      // Close whatever modal is open
      if (container.id === 'checkoutOverlay') hideCheckoutForm();
      else if (container.id === 'cartModal') hideCartModal();
      else if (container.id === 'detailModal') hideDetailModal();
      else if (container.id === 'variantModal') hideModal();
    }
  };

  container.addEventListener('keydown', container._trapHandler);
  setTimeout(() => first.focus(), 50);
}

// =========================================================
//  EVENT BINDINGS
// =========================================================

// Search
document.getElementById('searchInput').addEventListener('input', (e) => {
  const searchTerm = e.target.value.toLowerCase().trim();
  performSearch(searchTerm);
  applyCurrentFilters();
  renderProducts();
  updateResultsCount();
  persistFiltersToURL();
});

// Filter pills
document.querySelectorAll('.filter-pill').forEach(pill => {
  pill.setAttribute('role', 'button');
  pill.setAttribute('tabindex', '0');

  const handler = () => {
    if (pill.dataset.filter === 'categories') return;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    document.getElementById('categoryPillsSection').classList.remove('show');
    applyCurrentFilters();
    renderProducts();
    updateResultsCount();
    persistFiltersToURL();
  };

  pill.addEventListener('click', handler);
  pill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  });
});

// Modal controls
document.getElementById('modalClose').addEventListener('click', hideModal);
document.getElementById('btnCancel').addEventListener('click', hideModal);
document.getElementById('btnOrder').addEventListener('click', () => {
  if (selectedProduct.variants.length > 0 && !selectedVariant) {
    alert('Please select an option first');
    return;
  }
  addToCart(selectedProduct, selectedVariant);
});

document.getElementById('variantModal').addEventListener('click', (e) => {
  if (e.target.id === 'variantModal') hideModal();
});

// Cart modal controls
document.getElementById('cartIconBtn').setAttribute('role', 'button');
document.getElementById('cartIconBtn').setAttribute('tabindex', '0');
document.getElementById('cartIconBtn').setAttribute('aria-label', 'Open cart');
document.getElementById('cartIconBtn').addEventListener('click', showCartModal);
document.getElementById('cartIconBtn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCartModal(); }
});
document.getElementById('cartModalClose').addEventListener('click', hideCartModal);
document.getElementById('btnCheckout').addEventListener('click', proceedToWhatsApp);
document.getElementById('btnClearCart').addEventListener('click', () => {
  if (confirm('Are you sure you want to clear your cart?')) clearCart();
});

document.getElementById('cartModal').addEventListener('click', (e) => {
  if (e.target.id === 'cartModal') hideCartModal();
});

// Checkout form controls
document.getElementById('checkoutFormClose').addEventListener('click', hideCheckoutForm);
document.getElementById('checkoutCancelBtn').addEventListener('click', hideCheckoutForm);
document.getElementById('checkoutSendBtn').addEventListener('click', sendToWhatsApp);
document.getElementById('checkoutOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'checkoutOverlay') hideCheckoutForm();
});

// Country → State cascade
document.getElementById('checkoutCountry').addEventListener('change', function() {
  const stateSelect = document.getElementById('checkoutState');
  const states = LOCATION_DATA[this.value] || [];
  if (states.length > 0) {
    stateSelect.innerHTML = '<option value="">Select state/region…</option>';
    states.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      stateSelect.appendChild(opt);
    });
    stateSelect.disabled = false;
  } else if (this.value === 'Other Country') {
    stateSelect.innerHTML = '<option value="">Type city below instead</option>';
    stateSelect.disabled = true;
  } else {
    stateSelect.innerHTML = '<option value="">Select country first…</option>';
    stateSelect.disabled = true;
  }
});

// Categories toggle
const categoriesToggle = document.getElementById('categoriesToggle');
const categoryPillsSection = document.getElementById('categoryPillsSection');

categoriesToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const isActive = categoriesToggle.classList.contains('active');
  if (isActive) {
    categoriesToggle.classList.remove('active');
    categoryPillsSection.classList.remove('show');
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    filteredProducts = [...allProducts];
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    document.querySelector('.filter-pill[data-filter="all"]').classList.add('active');
    renderProducts();
    updateResultsCount();
    persistFiltersToURL();
  } else {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    categoriesToggle.classList.add('active');
    categoryPillsSection.classList.add('show');
  }
});

// Category pills
document.querySelectorAll('.category-pill').forEach(pill => {
  pill.setAttribute('role', 'button');
  pill.setAttribute('tabindex', '0');

  const handler = () => {
    const category = pill.dataset.category;
    const isActive = pill.classList.contains('active');
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    if (isActive) {
      filteredProducts = [...allProducts];
      renderProducts();
      updateResultsCount();
    } else {
      pill.classList.add('active');
      filterByCategory(category);
    }
    persistFiltersToURL();
  };

  pill.addEventListener('click', handler);
  pill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  });
});

// Search clear button
const searchClearBtn = document.getElementById('searchClear');
searchClearBtn.addEventListener('click', () => {
  const si = document.getElementById('searchInput');
  si.value = '';
  si.dispatchEvent(new Event('input'));
  si.focus();
  searchClearBtn.classList.remove('visible');
});

document.getElementById('searchInput').addEventListener('input', function() {
  searchClearBtn.classList.toggle('visible', this.value.length > 0);
});

// Search focus behavior
const searchInput = document.getElementById('searchInput');
const filterSection = document.querySelector('.filter-section');
const stickySearch = document.getElementById('stickySearch');

searchInput.addEventListener('focus', () => {
  stickySearch.classList.add('search-active');
  filterSection.classList.add('show');
});

searchInput.addEventListener('blur', () => {
  setTimeout(() => {
    if (!document.activeElement.closest('.filter-section') &&
        !document.activeElement.closest('.category-pills-section')) {
      stickySearch.classList.remove('search-active');
      if (!searchInput.value) filterSection.classList.remove('show');
    }
  }, 200);
});

// =========================================================
//  SCROLL EFFECTS
// =========================================================

const heroSection = document.getElementById('heroSection');
let ticking = false;

function handleScroll() {
  const scrollY = window.scrollY;
  const heroHeight = heroSection ? heroSection.offsetHeight : 0;

  if (heroSection && scrollY < heroHeight) {
    heroSection.style.transform = `translateY(${scrollY * 0.5}px)`;
    heroSection.style.opacity = 1 - (scrollY / heroHeight) * 0.7;
  }

  const backToTop = document.getElementById('backToTop');
  if (backToTop) {
    backToTop.classList.toggle('show', scrollY > heroHeight);
  }

  ticking = false;
}

window.addEventListener('scroll', () => {
  if (!ticking) { window.requestAnimationFrame(handleScroll); ticking = true; }
});

// Filter scroll hint
const filterScrollWrap = document.getElementById('filterScrollWrap');
const filterSectionEl = filterScrollWrap?.querySelector('.filter-section');
if (filterSectionEl && filterScrollWrap) {
  const checkScrollEnd = () => {
    const atEnd = filterSectionEl.scrollLeft + filterSectionEl.clientWidth >= filterSectionEl.scrollWidth - 8;
    filterScrollWrap.classList.toggle('at-end', atEnd);
  };
  filterSectionEl.addEventListener('scroll', checkScrollEnd, { passive: true });
  checkScrollEnd();
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});

// Back to top
document.getElementById('backToTop').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Product detail modal controls
document.getElementById('detailModalClose').addEventListener('click', hideDetailModal);
document.getElementById('detailCloseBtn').addEventListener('click', hideDetailModal);
document.getElementById('detailAddBtn').addEventListener('click', addToCartFromDetail);
document.getElementById('detailModal').addEventListener('click', (e) => {
  if (e.target.id === 'detailModal') hideDetailModal();
});

// Infinite scroll observer
const loadMoreObserver = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && displayedCount < filteredProducts.length) {
    loadMoreProducts();
  }
}, { rootMargin: '300px' });

const loadSentinel = document.getElementById('loadMoreSentinel');
if (loadSentinel) loadMoreObserver.observe(loadSentinel);

// ── Initialize ──
loadProducts();
