(() => {
  'use strict';

  const GROUPS = [
    {
      key: 'command',
      label: 'Command Center',
      routes: ['dashboard', 'kpi', 'notifications'],
    },
    {
      key: 'demand',
      label: 'Demand & Requests',
      routes: ['create-request', 'requests', 'approvals', 'erp-operator'],
    },
    {
      key: 'inbound',
      label: 'Inbound Operations',
      routes: ['receiving', 'qr-printing', 'quality', 'batches', 'expiry'],
    },
    {
      key: 'execution',
      label: 'Warehouse Execution',
      routes: ['warehouse', 'allocation', 'picker-assign', 'picking', 'reallocation'],
    },
    {
      key: 'outbound',
      label: 'Outbound Operations',
      routes: ['gi-posting', 'shipping'],
    },
    {
      key: 'inventory-control',
      label: 'Inventory Control',
      routes: ['physical-inventory', 'cycle-count', 'all-locations', 'empty-locations'],
    },
    {
      key: 'intelligence',
      label: 'Intelligence & Analytics',
      routes: ['ai'],
    },
    {
      key: 'master-integration',
      label: 'Master Data & Integration',
      routes: ['materials', 'locations', 'warehouses-master', 'bins-master', 'movement-types', 'import'],
    },
    {
      key: 'governance',
      label: 'Governance & Administration',
      routes: ['audit', 'users', 'permissions'],
    },
    {
      key: 'subcontractor',
      label: 'Subcontractor Materials',
      routes: ['subcontractor-quality', 'subcontractor-stock', 'subcontractors'],
    },
  ];

  // Presentation-only workspace profiles. Group routes remain permission-filtered
  // by the base application; these presets only order visible groups and choose
  // their initial open state for the logged-in role.
  const ROLE_PROFILES = {
    picker: {
      label: 'Picker workspace', groups: ['execution', 'inbound', 'inventory-control', 'demand', 'command'], defaultOpen: ['execution'],
    },
    erp_operator: {
      label: 'ERP Operator workspace', groups: ['demand', 'command', 'master-integration', 'execution', 'inventory-control'], defaultOpen: ['demand'],
    },
    warehouse_supervisor: {
      label: 'Warehouse Manager workspace', groups: ['execution', 'inventory-control', 'inbound', 'outbound', 'command', 'demand'], defaultOpen: ['execution'],
    },
    admin: { label: 'Admin / System workspace', groups: null, defaultOpen: GROUPS.map((group) => group.key) },
  };

  const LABELS = {
    dashboard: 'Operations Overview',
    kpi: 'Performance Cockpit',
    notifications: 'Alerts & Notifications',
    'create-request': 'Create Material Request',
    requests: 'Request Work Queue',
    approvals: 'Approval Work Queue',
    'erp-operator': 'ERP Processing Queue',
    receiving: 'Goods Receipt & Identification',
    'qr-printing': 'QR & Label Printing',
    quality: 'Quality Inspection',
    batches: 'Batch Traceability',
    expiry: 'Shelf-life & Expiry Control',
    warehouse: 'Execution Control Board',
    allocation: 'Bin & Batch Allocation',
    'picker-assign': 'Work Assignment',
    picking: 'Picking Tasks',
    reallocation: 'Stock Reallocation',
    'gi-posting': 'Goods Issue Posting',
    shipping: 'Packing, Dispatch & Shipping',
    'physical-inventory': 'Physical Inventory',
    'cycle-count': 'Cycle Counting',
    'all-locations': 'Stock by Location',
    'empty-locations': 'Available Locations',
    ai: 'AI Inventory Intelligence',
    materials: 'Material Master',
    locations: 'Storage Location Master',
    'warehouses-master': 'Warehouse Master',
    'bins-master': 'Bin Master',
    'movement-types': 'Movement Type Configuration',
    import: 'Data Integration Center',
    audit: 'Audit & Traceability',
    users: 'User Administration',
    permissions: 'Roles & Permissions',
    'subcontractor-quality': 'Deliveries & Quality Inspection',
    'subcontractor-stock': 'Subcontractor On-Hand Stock',
    subcontractors: 'Subcontractors & Categories',
  };

  function routeOf(link) {
    const href = link.getAttribute('href') || '';
    return href.replace(/^#\//, '').split('/')[0];
  }

  function roleProfile() {
    const role = window.App?.user?.role || 'default';
    const profile = ROLE_PROFILES[role] || { label: 'Workspace', groups: null, defaultOpen: GROUPS.map((group) => group.key) };
    return { ...profile, role };
  }

  function orderedGroups(profile) {
    if (!profile.groups) return [...GROUPS];
    const rank = new Map(profile.groups.map((key, index) => [key, index]));
    return [...GROUPS].sort((left, right) => (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER));
  }

  function groupPreferenceKey(profile, group) { return `wms_v2_group_${profile.role}_${group.key}`; }

  function makeGroup(def, links, activeRoute, profile) {
    const wrapper = document.createElement('div');
    wrapper.className = 'nav-group kynox-nav-group';
    wrapper.dataset.key = `v2-${def.key}`;
    if (profile?.groups?.slice(0, 2).includes(def.key)) wrapper.classList.add('profile-primary');

    const hasActive = def.routes.includes(activeRoute);
    const saved = localStorage.getItem(groupPreferenceKey(profile, def));
    const isOpen = hasActive || (saved == null ? profile.defaultOpen.includes(def.key) : saved === 'open');
    if (isOpen) wrapper.classList.add('open');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'nav-group-head';
    head.setAttribute('aria-expanded', String(isOpen));
    head.innerHTML = `<span class="kynox-module-mark" aria-hidden="true"></span><span class="lbl"></span><svg class="ico chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    head.querySelector('.lbl').textContent = def.label;

    const body = document.createElement('div');
    body.className = 'nav-group-body';
    def.routes.forEach((route) => {
      const link = links.get(route);
      if (!link) return;
      const label = link.querySelector('.lbl');
      if (label && LABELS[route] && label.textContent !== LABELS[route]) label.textContent = LABELS[route];
      const nextTitle = LABELS[route] || link.title;
      if (link.title !== nextTitle) link.title = nextTitle;
      body.appendChild(link);
    });

    head.addEventListener('click', () => {
      const open = wrapper.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
      localStorage.setItem(groupPreferenceKey(profile, def), open ? 'open' : 'closed');
    });

    wrapper.append(head, body);
    return wrapper;
  }

  function enhanceNavigation() {
    const tree = document.querySelector('.nav-tree');
    if (!tree || tree.dataset.kynoxV2 === '1') return;

    const links = new Map();
    tree.querySelectorAll('a.nav-item[href^="#/"]').forEach((link) => {
      const route = routeOf(link);
      if (route && route !== 'home') links.set(route, link);
    });

    if (!links.size) return;

    const active = routeOf(tree.querySelector('a.nav-item.active') || document.createElement('a'));
    const home = tree.querySelector('a.nav-home');
    const fragment = document.createDocumentFragment();

    if (home) {
      const label = home.querySelector('.lbl');
      if (label && label.textContent !== 'Workspace Home') label.textContent = 'Workspace Home';
      fragment.appendChild(home);
    }

    const profile = roleProfile();
    const profileLabel = document.createElement('div');
    profileLabel.className = 'nav-profile kynox-nav-profile';
    profileLabel.setAttribute('aria-label', 'Current workspace');
    profileLabel.textContent = profile.label;
    fragment.appendChild(profileLabel);

    orderedGroups(profile).forEach((group) => {
      if (group.routes.some((route) => links.has(route))) {
        fragment.appendChild(makeGroup(group, links, active, profile));
      }
    });

    const unassigned = [...links.entries()].filter(([route]) => !GROUPS.some((g) => g.routes.includes(route)));
    if (unassigned.length) {
      const other = { key: 'other', label: 'Additional Operations', routes: unassigned.map(([route]) => route) };
      fragment.appendChild(makeGroup(other, links, active, profile));
    }

    tree.replaceChildren(fragment);
    tree.dataset.kynoxV2 = '1';
  }

  function applyShellIdentity() {
    const brand = document.querySelector('.sidebar .brand-name');
    if (brand && brand.textContent !== 'KYNOX WMS') brand.textContent = 'KYNOX WMS';
    const mark = document.querySelector('.sidebar .brand-mark');
    if (mark && !mark.querySelector('img')) {
      mark.textContent = '';
      const img = document.createElement('img');
      img.src = '/img/kynox-mark.png';
      img.alt = 'KYNOX';
      mark.appendChild(img);
    }
    if (!document.documentElement.classList.contains('kynox-v2')) {
      document.documentElement.classList.add('kynox-v2');
    }
  }

  const observer = new MutationObserver(() => {
    const tree = document.querySelector('.nav-tree');
    if (tree && tree.dataset.kynoxV2 !== '1') enhanceNavigation();
    applyShellIdentity();
  });

  observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  enhanceNavigation();
  applyShellIdentity();
})();
