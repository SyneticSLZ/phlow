
        
        // API Configuration
        const API_BASE = 'http://localhost:5050/api';
        
        // State Management
        let currentPage = 1;
        let currentFilters = {
            priorityTier: '',
            hasPhase1: null,
            needsCDMO: null,
            excludeStale: true,
            search: ''
        };
        let currentView = 'dashboard';

        // Initialize Application
        document.addEventListener('DOMContentLoaded', function() {
            loadDashboard();
            setupEventListeners();
            startAutoRefresh();
        });

        // Setup Event Listeners
        function setupEventListeners() {
            // Navigation
            document.querySelectorAll('.nav-item').forEach(item => {
                item.addEventListener('click', function(e) {
                    e.preventDefault();
                    const page = this.dataset.page;
                    navigateToPage(page);
                });
            });

            // Search
            document.getElementById('globalSearch').addEventListener('input', debounce(function(e) {
                currentFilters.search = e.target.value;
                loadLeads();
            }, 500));

            // Filters
            document.getElementById('filterTier').addEventListener('change', function(e) {
                currentFilters.priorityTier = e.target.value;
                loadLeads();
            });

            document.getElementById('excludeStale').addEventListener('click', function() {
                currentFilters.excludeStale = !currentFilters.excludeStale;
                this.querySelector('span').textContent = currentFilters.excludeStale ? '✓' : '';
                loadLeads();
            });

            // Refresh
            document.getElementById('refreshData').addEventListener('click', function() {
                loadDashboard();
            });

            // Export
            document.getElementById('exportLeads').addEventListener('click', function() {
                exportLeads();
            });

            // Details Panel
            document.getElementById('closePanel').addEventListener('click', function() {
                closeDetailsPanel();
            });

            // Pagination
            document.getElementById('prevPage').addEventListener('click', function() {
                if (currentPage > 1) {
                    currentPage--;
                    loadLeads();
                }
            });

            document.getElementById('nextPage').addEventListener('click', function() {
                currentPage++;
                loadLeads();
            });
        }

        // Load Dashboard Data
        async function loadDashboard() {
            try {
                // Fetch dashboard stats
                const statsResponse = await fetch(`${API_BASE}/stats/dashboard`);
                const stats = await statsResponse.json();

                // Update metrics
                document.getElementById('metricCompanies').textContent = stats.overview.totalCompanies.toLocaleString();
                document.getElementById('metricTierA').textContent = stats.overview.tierACompanies.toLocaleString();
                document.getElementById('metricPhase1').textContent = stats.trials.phase1Trials.toLocaleString();
                document.getElementById('metricNeedsCDMO').textContent = stats.overview.companiesNeedingCDMO.toLocaleString();

                // Update changes
                document.getElementById('metricCompaniesChange').textContent = `${stats.recentActivity.last7Days.companies} this week`;
                document.getElementById('metricTierAChange').textContent = `${stats.overview.tierACompanies} qualified`;
                document.getElementById('metricPhase1Change').textContent = `${stats.recentActivity.last7Days.trials} new`;
                document.getElementById('metricNeedsCDMOChange').textContent = `${stats.overview.companiesNeedingCDMO} identified`;

                // Update navigation badges
                document.getElementById('leadCount').textContent = stats.overview.scoredCompanies;

                // Load leads table
                loadLeads();
            } catch (error) {
                console.error('Error loading dashboard:', error);
                showError('Failed to load dashboard data');
            }
        }

        // Load Leads Table
        async function loadLeads() {
            try {
                const params = new URLSearchParams({
                    page: currentPage,
                    pageSize: 10,
                    ...currentFilters
                });

                const response = await fetch(`${API_BASE}/leads?${params}`);
                const data = await response.json();

                // Update table
                const tbody = document.getElementById('leadsTableBody');
                if (data.leads.length === 0) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="8">
                                <div class="empty-state">
                                    <div class="empty-icon">📊</div>
                                    <div class="empty-title">No leads found</div>
                                    <div class="empty-text">Try adjusting your filters or refresh the data</div>
                                </div>
                            </td>
                        </tr>
                    `;
                    return;
                }

                tbody.innerHTML = data.leads.map(lead => `
                    <tr>
                        <td>
                            <div class="company-info">
                                <div class="company-avatar">${getInitials(lead.name)}</div>
                                <div class="company-details">
                                    <div class="company-name" onclick="openCompanyDetails(${lead.id})">${lead.name}</div>
                                    <div class="company-meta">${lead.country || 'Unknown'}</div>
                                </div>
                            </div>
                        </td>
                        <td>
                            <span class="score-badge tier-${(lead.priority_tier || 'c').toLowerCase()}">
                                ${lead.overall_score?.toFixed(0) || 0} - Tier ${lead.priority_tier || '-'}
                            </span>
                        </td>
                        <td>${lead.phase1_count > 0 ? 'Phase 1' : 'Pre-clinical'}</td>
                        <td>
                            <div class="molecule-pills">
                                ${lead.molecule_count > 0 ? `<span class="molecule-pill">${lead.molecule_count} molecules</span>` : '-'}
                            </div>
                        </td>
                        <td>${lead.total_funding ? '$' + (lead.total_funding / 1000000).toFixed(1) + 'M' : '-'}</td>
                        <td>${lead.employee_band || 'Unknown'}</td>
                        <td>
                            <span class="status-badge ${lead.is_stale ? 'stale' : 'active'}">
                                ${lead.is_stale ? 'Stale' : lead.needs_cdmo ? 'Needs CDMO' : 'Active'}
                            </span>
                        </td>
                        <td>
                            <button class="btn-action" onclick="openCompanyDetails(${lead.id})">View</button>
                        </td>
                    </tr>
                `).join('');

                // Update pagination
                document.getElementById('showingStart').textContent = ((currentPage - 1) * 10) + 1;
                document.getElementById('showingEnd').textContent = Math.min(currentPage * 10, data.total);
                document.getElementById('totalResults').textContent = data.total;

                // Update pagination buttons
                document.getElementById('prevPage').disabled = currentPage === 1;
                document.getElementById('nextPage').disabled = currentPage >= data.totalPages;
            } catch (error) {
                console.error('Error loading leads:', error);
                showError('Failed to load leads');
            }
        }

        // Open Company Details Panel
        async function openCompanyDetails(companyId) {
            try {
                const response = await fetch(`${API_BASE}/leads/${companyId}`);
                const data = await response.json();

                const panel = document.getElementById('detailsPanel');
                const panelContent = document.getElementById('panelContent');
                
                document.getElementById('panelTitle').textContent = data.company.name;

                panelContent.innerHTML = `
                    <!-- Company Overview -->
                    <div class="panel-section">
                        <h3 class="panel-section-title">Company Overview</h3>
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">Score</span>
                                <span class="info-value">${data.score?.overall_score?.toFixed(0) || 0} - Tier ${data.score?.priority_tier || '-'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Employees</span>
                                <span class="info-value">${data.company.employee_band || 'Unknown'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Country</span>
                                <span class="info-value">${data.company.country || 'Unknown'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Status</span>
                                <span class="info-value">${data.score?.is_stale ? 'Stale' : data.score?.needs_cdmo ? 'Needs CDMO' : 'Active'}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Molecules -->
                    <div class="panel-section">
                        <h3 class="panel-section-title">Molecules (${data.molecules.length})</h3>
                        ${data.molecules.map(mol => `
                            <div class="info-item" style="margin-bottom: 12px;">
                                <span class="info-label">${mol.name}</span>
                                <span class="info-value">${mol.indication || 'Unknown indication'} - ${mol.development_stage || 'Stage unknown'}</span>
                            </div>
                        `).join('') || '<p style="color: var(--gray-500); font-size: 14px;">No molecules recorded</p>'}
                    </div>

                    <!-- Clinical Trials -->
                    <div class="panel-section">
                        <h3 class="panel-section-title">Clinical Trials (${data.trials.length})</h3>
                        ${data.trials.map(trial => `
                            <div class="info-item" style="margin-bottom: 12px;">
                                <span class="info-label">${trial.trial_id}</span>
                                <span class="info-value">${trial.phase} - ${trial.status}</span>
                            </div>
                        `).join('') || '<p style="color: var(--gray-500); font-size: 14px;">No trials recorded</p>'}
                    </div>

                    <!-- Funding -->
                    <div class="panel-section">
                        <h3 class="panel-section-title">Funding History (${data.funding.length})</h3>
                        ${data.funding.map(round => `
                            <div class="info-item" style="margin-bottom: 12px;">
                                <span class="info-label">${round.round_type} - ${new Date(round.date).toLocaleDateString()}</span>
                                <span class="info-value">$${(round.amount_usd / 1000000).toFixed(1)}M</span>
                            </div>
                        `).join('') || '<p style="color: var(--gray-500); font-size: 14px;">No funding recorded</p>'}
                    </div>

                    <!-- Key Contacts -->
                    <div class="panel-section">
                        <h3 class="panel-section-title">Key Contacts (${data.contacts.length})</h3>
                        <div class="contact-list">
                            ${data.contacts.map(contact => `
                                <div class="contact-item">
                                    <div class="contact-avatar">${getInitials(contact.name)}</div>
                                    <div class="contact-info">
                                        <div class="contact-name">${contact.name}</div>
                                        <div class="contact-title">${contact.title}</div>
                                    </div>
                                    <div class="contact-actions">
                                        ${contact.email ? `<a class="contact-action" href="mailto:${contact.email}" title="Email">✉</a>` : ''}
                                        ${contact.linkedin_url ? `<a class="contact-action" href="${contact.linkedin_url}" target="_blank" title="LinkedIn">in</a>` : ''}
                                    </div>
                                </div>
                            `).join('') || '<p style="color: var(--gray-500); font-size: 14px;">No contacts found</p>'}
                        </div>
                        ${data.contacts.length === 0 ? `
                            <button class="btn-action btn-primary" style="width: 100%; margin-top: 12px;" onclick="discoverContacts(${companyId})">
                                Discover Contacts
                            </button>
                        ` : ''}
                    </div>

                    <!-- Recent Signals -->
                    <div class="panel-section">
                        <h3 class="panel-section-title">Recent Signals (${data.signals.length})</h3>
                        ${data.signals.slice(0, 5).map(signal => `
                            <div class="info-item" style="margin-bottom: 12px;">
                                <span class="info-label">${signal.signal_type} - ${new Date(signal.date).toLocaleDateString()}</span>
                                <span class="info-value">${signal.title}</span>
                            </div>
                        `).join('') || '<p style="color: var(--gray-500); font-size: 14px;">No recent signals</p>'}
                    </div>
                `;

                panel.classList.add('open');
            } catch (error) {
                console.error('Error loading company details:', error);
                showError('Failed to load company details');
            }
        }

        // Close Details Panel
        function closeDetailsPanel() {
            document.getElementById('detailsPanel').classList.remove('open');
        }

        // Discover Contacts
        async function discoverContacts(companyId) {
            try {
                const response = await fetch(`${API_BASE}/contacts/discover/${companyId}`, {
                    method: 'POST'
                });
                const result = await response.json();
                
                if (result.success) {
                    showSuccess(`Found ${result.added} contacts`);
                    openCompanyDetails(companyId); // Refresh panel
                }
            } catch (error) {
                console.error('Error discovering contacts:', error);
                showError('Failed to discover contacts');
            }
        }

        // Export Leads
        async function exportLeads() {
            try {
                window.location.href = `${API_BASE}/export/leads`;
            } catch (error) {
                console.error('Error exporting leads:', error);
                showError('Failed to export leads');
            }
        }

        // Navigate to Page
        function navigateToPage(page) {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(`[data-page="${page}"]`).classList.add('active');
            currentView = page;
            
            // Load appropriate view based on page
            switch(page) {
                case 'dashboard':
                    loadDashboard();
                    break;
                case 'leads':
                    loadLeads();
                    break;
                // Add other page handlers as needed
            }
        }

        // Auto Refresh
        function startAutoRefresh() {
            setInterval(() => {
                if (currentView === 'dashboard') {
                    loadDashboard();
                }
            }, 60000); // Refresh every minute
        }

        // Utility Functions
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        function getInitials(name) {
            if (!name) return '?';
            const parts = name.split(' ');
            if (parts.length >= 2) {
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            }
            return name.substring(0, 2).toUpperCase();
        }

        function showError(message) {
            console.error(message);
            // Implement toast notification
        }

        function showSuccess(message) {
            console.log(message);
            // Implement toast notification
        }

