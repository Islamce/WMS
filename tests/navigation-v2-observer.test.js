const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'navigation-v2.js'), 'utf8');

if (!source.includes("brand && brand.textContent !== 'KYNOX WMS'")) {
  throw new Error('Brand update must be guarded to prevent MutationObserver loops.');
}
if (!source.includes("mark && mark.textContent !== 'K'")) {
  throw new Error('Brand mark update must be guarded to prevent MutationObserver loops.');
}
if (!source.includes("!document.documentElement.classList.contains('kynox-v2')")) {
  throw new Error('Root class mutation must be guarded.');
}

console.log('navigation-v2 observer guards verified');
