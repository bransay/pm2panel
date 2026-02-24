const { createApp, ref, computed, onMounted, onUnmounted, watch } = Vue;

const TABLE_MIN_WIDTH = 900;

createApp({
    setup() {
        const processes = ref([]);
        const folders = ref([]);
        const containerRef = ref(null);
        const useCardView = ref(false);
        const currentDir = ref('/');
        const choosedPath = ref('');
        const now = ref(Date.now());
        const loading = ref(true);
        const isLoggedIn = ref(false);
        const showLoginModal = ref(false);
        const showAddDrawer = ref(false);
        const showLogsModal = ref(false);
        const logsContent = ref('');
        const logsProcessName = ref('');
        const loginLoading = ref(false);
        const loginError = ref('');
        const toasts = ref([]);
        const pollEnabled = ref(true);
        const pollInterval = ref(3);
        const sortKey = ref('pm_id');
        const sortOrder = ref(1);
        const metricsHistory = ref({});
        const HISTORY_LENGTH = 20;

        const loginForm = ref({
            username: '',
            password: '',
            rememberMe: false
        });

        let pollTimer = null;

        const sortedProcesses = computed(() => {
            const sorted = [...processes.value].sort((a, b) => {
                let aVal, bVal;
                switch (sortKey.value) {
                    case 'name':
                        aVal = a.name;
                        bVal = b.name;
                        break;
                    case 'pm_id':
                        aVal = a.pm_id;
                        bVal = b.pm_id;
                        break;
                    case 'pid':
                        aVal = a.pid || 0;
                        bVal = b.pid || 0;
                        break;
                    case 'status':
                        aVal = a.pm2_env.status;
                        bVal = b.pm2_env.status;
                        break;
                    case 'cpu':
                        aVal = a.monit.cpu;
                        bVal = b.monit.cpu;
                        break;
                    case 'memory':
                        aVal = a.monit.memory;
                        bVal = b.monit.memory;
                        break;
                    default:
                        return 0;
                }
                if (typeof aVal === 'string') {
                    return sortOrder.value * aVal.localeCompare(bVal);
                }
                return sortOrder.value * (aVal - bVal);
            });
            return sorted;
        });

        const checkAuth = async () => {
            try {
                const res = await fetch('/getProccess');
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        isLoggedIn.value = true;
                    }
                }
            } catch (e) {
                isLoggedIn.value = false;
            }
        };

        const fetchData = async (silent = false) => {
            if (!isLoggedIn.value) {
                if (!silent) loading.value = false;
                return;
            }
            
            if (!silent) loading.value = true;
            try {
                const res = await fetch('/getProccess');
                if (!res.ok) {
                    if (res.status === 401 || res.status === 302) {
                        isLoggedIn.value = false;
                        showLoginModal.value = true;
                    }
                    return;
                }
                const data = await res.json();
                if (Array.isArray(data)) {
                    processes.value = data;
                    now.value = Date.now();
                    updateMetricsHistory(data);
                }
            } catch (e) {
                if (!silent) showToast('Failed to fetch processes: ' + e.message, 'error');
            } finally {
                if (!silent) loading.value = false;
            }
        };

        const fetchFolders = async (path = '') => {
            try {
                const url = path ? `/folder?path=${encodeURIComponent(path)}` : '/folder';
                const res = await fetch(url);
                if (res.ok) {
                    folders.value = await res.json();
                }
            } catch (e) {
                console.error('Failed to fetch folders:', e);
            }
        };

        const updateMetricsHistory = (data) => {
            data.forEach(p => {
                if (!metricsHistory.value[p.pm_id]) {
                    metricsHistory.value[p.pm_id] = { cpu: [], memory: [] };
                }
                metricsHistory.value[p.pm_id].cpu.push(p.monit.cpu);
                metricsHistory.value[p.pm_id].memory.push(p.monit.memory);
                if (metricsHistory.value[p.pm_id].cpu.length > HISTORY_LENGTH) {
                    metricsHistory.value[p.pm_id].cpu.shift();
                    metricsHistory.value[p.pm_id].memory.shift();
                }
            });
        };

        const getSparklinePoints = (pmId, type) => {
            const history = metricsHistory.value[pmId];
            if (!history || history[type].length < 2) return '0,10 100,10';
            
            const values = history[type];
            const maxVal = Math.max(...values, 1);
            const points = values.map((v, i) => {
                const x = (i / (HISTORY_LENGTH - 1)) * 100;
                const y = 20 - (v / maxVal) * 18;
                return `${x},${y}`;
            });
            return points.join(' ');
        };

        const startPolling = () => {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
            if (pollEnabled.value && pollInterval.value >= 1) {
                pollTimer = setInterval(() => fetchData(true), pollInterval.value * 1000);
            }
        };

        watch([pollEnabled, pollInterval], () => {
            startPolling();
        });

        const sortBy = (key) => {
            if (sortKey.value === key) {
                sortOrder.value = -sortOrder.value;
            } else {
                sortKey.value = key;
                sortOrder.value = 1;
            }
        };

        const login = async () => {
            loginLoading.value = true;
            loginError.value = '';
            try {
                const res = await fetch('/loginCheck', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    body: new URLSearchParams({
                        username: loginForm.value.username,
                        passwd: loginForm.value.password,
                        remember: loginForm.value.rememberMe ? '1' : '0'
                    })
                });
                if (res.ok) {
                    isLoggedIn.value = true;
                    showLoginModal.value = false;
                    loginForm.value = { username: '', password: '', rememberMe: false };
                    fetchData();
                    fetchFolders();
                    startPolling();
                } else {
                    loginError.value = 'Invalid credentials';
                }
            } catch (e) {
                loginError.value = 'Login failed: ' + e.message;
            } finally {
                loginLoading.value = false;
            }
        };

        const logout = async () => {
            await fetch('/logout');
            isLoggedIn.value = false;
            processes.value = [];
        };

        const executeAction = async (action, id) => {
            try {
                const res = await fetch(`/${action}?id=${id}`);
                const text = await res.text();
                showToast(`${action} command sent`, 'success');
                setTimeout(() => fetchData(true), 500);
            } catch (e) {
                showToast(`Failed to ${action}: ${e.message}`, 'error');
            }
        };

        const confirmDelete = async (id) => {
            if (confirm('Are you sure you want to delete this process?')) {
                await executeAction('delete', id);
            }
        };

        const showLogs = async (id) => {
            try {
                const res = await fetch(`/log?id=${id}`);
                logsContent.value = await res.text();
                const proc = processes.value.find(p => p.pm_id === id);
                logsProcessName.value = proc ? proc.name : `Process ${id}`;
                showLogsModal.value = true;
            } catch (e) {
                showToast('Failed to fetch logs', 'error');
            }
        };

        const addProcess = async () => {
            if (!choosedPath.value) return;
            try {
                const res = await fetch('/addProccess', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `path=${encodeURIComponent(choosedPath.value)}`
                });
                if (res.ok) {
                    showToast('Process added successfully', 'success');
                    choosedPath.value = '';
                    showAddDrawer.value = false;
                    setTimeout(fetchData, 500);
                }
            } catch (e) {
                showToast('Failed to add process: ' + e.message, 'error');
            }
        };

        const saveProcesses = async () => {
            try {
                await fetch('/dump');
                showToast('Processes saved', 'success');
            } catch (e) {
                showToast('Failed to save: ' + e.message, 'error');
            }
        };

        const selectPath = (path) => {
            choosedPath.value = path;
        };

        const exploreFolder = async (path) => {
            currentDir.value = path;
            await fetchFolders(path);
        };

        const getStatusClass = (status) => {
            switch (status) {
                case 'online': return 'badge-success';
                case 'stopping': case 'stopped': return 'badge-warning';
                case 'errored': return 'badge-error';
                default: return 'badge-ghost';
            }
        };

        const formatUptime = (ms) => {
            const sec = Math.floor(ms / 1000);
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const s = sec % 60;
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        };

        const formatMemory = (bytes) => {
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        };

        const showToast = (message, type = 'info') => {
            toasts.value.push({ message, type });
            setTimeout(() => toasts.value.shift(), 5000);
        };

        const removeToast = (index) => {
            toasts.value.splice(index, 1);
        };

        const checkWidth = () => {
            if (containerRef.value) {
                useCardView.value = containerRef.value.offsetWidth < TABLE_MIN_WIDTH;
            }
        };

        let resizeObserver = null;
        let dropdownCloser = null;

        onMounted(async () => {
            await checkAuth();
            if (isLoggedIn.value) {
                await Promise.all([fetchData(), fetchFolders()]);
                startPolling();
            } else {
                showLoginModal.value = true;
            }
            checkWidth();
            resizeObserver = new ResizeObserver(checkWidth);
            if (containerRef.value) {
                resizeObserver.observe(containerRef.value);
            }
            dropdownCloser = (e) => {
                if (e.target.closest('.dropdown-content')) {
                    document.activeElement?.blur();
                }
            };
            document.addEventListener('click', dropdownCloser);
        });

        onUnmounted(() => {
            if (pollTimer) clearInterval(pollTimer);
            if (resizeObserver) resizeObserver.disconnect();
            if (dropdownCloser) document.removeEventListener('click', dropdownCloser);
        });

        return {
            processes,
            folders,
            containerRef,
            useCardView,
            currentDir,
            choosedPath,
            now,
            loading,
            isLoggedIn,
            showLoginModal,
            showAddDrawer,
            showLogsModal,
            logsContent,
            logsProcessName,
            loginLoading,
            loginError,
            loginForm,
            toasts,
            pollEnabled,
            pollInterval,
            sortedProcesses,
            sortKey,
            sortOrder,
            sortBy,
            fetchData,
            fetchFolders,
            login,
            logout,
            executeAction,
            confirmDelete,
            showLogs,
            addProcess,
            saveProcesses,
            selectPath,
            exploreFolder,
            getStatusClass,
            formatUptime,
            formatMemory,
            getSparklinePoints,
            showToast,
            removeToast
        };
    }
}).mount('#app');