// State management
let currentUser = null;
let selectedFilePath = "";
let useClientSideFallback = false;
let clientSideFileStore = null; // Stores { name, buffer, dataUrl } for offline mode

// Dom Elements
const authOverlay = document.getElementById("auth-overlay");
const authForm = document.getElementById("auth-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const authError = document.getElementById("auth-error");
const btnAuthSubmit = document.getElementById("btn-auth-submit");
const authSubmitText = document.getElementById("auth-submit-text");
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");

const userDisplayName = document.getElementById("user-display-name");
const btnLogout = document.getElementById("btn-logout");

const navItems = document.querySelectorAll(".nav-menu .nav-item");
const tabContents = document.querySelectorAll(".tab-content");

const manualFilePath = document.getElementById("manual-file-path");
const useSystemDialogs = document.getElementById("use-system-dialogs");
const btnSelectFile = document.getElementById("btn-select-file");
const browserFilePicker = document.getElementById("browser-file-picker");
const previewPlaceholder = document.getElementById("preview-placeholder");
const canvasPreview = document.getElementById("canvas-preview");

const generatorMode = document.getElementById("generator-mode");
const colorCombination = document.getElementById("color-combination");
const btnGenerate = document.getElementById("btn-generate");
const generatorStatus = document.getElementById("generator-status");

const stegoTabEmbed = document.getElementById("stego-tab-embed");
const stegoTabExtract = document.getElementById("stego-tab-extract");
const stegoSectEmbed = document.getElementById("stego-sect-embed");
const stegoSectExtract = document.getElementById("stego-sect-extract");

const embedMessage = document.getElementById("embed-message");
const btnEmbed = document.getElementById("btn-embed");
const stegoEmbedStatus = document.getElementById("stego-embed-status");

const extractedMessage = document.getElementById("extracted-message");
const btnExtract = document.getElementById("btn-extract");
const stegoExtractStatus = document.getElementById("stego-extract-status");

const historyFilesList = document.getElementById("history-files");
const historyModesList = document.getElementById("history-modes");
const historyEmbeddedList = document.getElementById("history-embedded");
const historyExtractedList = document.getElementById("history-extracted");

// Color combinations database
const colorCombos = {
    wave: [
        { value: "0", name: "Неоновий кіберпанк" },
        { value: "1", name: "Золотий ембер" },
        { value: "2", name: "Глибоке море" }
    ],
    plasma: [
        { value: "0", name: "Полум'я" },
        { value: "1", name: "Аврора" },
        { value: "2", name: "Психоделіка" }
    ],
    bitwise: [
        { value: "0", name: "Матриця" },
        { value: "1", name: "Монохром" },
        { value: "2", name: "Фіолетовий неон" }
    ]
};

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
    checkSession();
    setupEventListeners();
    updateColorComboOptions();
});

// Update Color Combination selector based on Mode
function updateColorComboOptions() {
    const mode = generatorMode.value;
    colorCombination.innerHTML = "";
    colorCombos[mode].forEach(combo => {
        const option = document.createElement("option");
        option.value = combo.value;
        option.textContent = combo.name;
        colorCombination.appendChild(option);
    });
}

// Navigation between tabs
function switchTab(tabId) {
    navItems.forEach(btn => {
        if (btn.getAttribute("data-tab") === tabId) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    tabContents.forEach(content => {
        if (content.id === `tab-content-${tabId}`) {
            content.classList.add("active");
        } else {
            content.classList.remove("active");
        }
    });
}

// Setup all event listeners
function setupEventListeners() {
    // Auth Tab switching
    let isRegisterMode = false;
    tabLogin.addEventListener("click", () => {
        isRegisterMode = false;
        tabLogin.classList.add("active");
        tabRegister.classList.remove("active");
        authSubmitText.textContent = "Увійти";
        authError.classList.add("hidden");
    });
    tabRegister.addEventListener("click", () => {
        isRegisterMode = true;
        tabRegister.classList.add("active");
        tabLogin.classList.remove("active");
        authSubmitText.textContent = "Зареєструватись";
        authError.classList.add("hidden");
    });

    // Auth Submit
    authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        authError.classList.add("hidden");

        if (useClientSideFallback) {
            handleAuthJS(username, password, isRegisterMode);
            return;
        }

        const endpoint = isRegisterMode ? "/api/register" : "/api/login";
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                currentUser = username;
                userDisplayName.textContent = currentUser;
                authOverlay.classList.remove("active");
                
                // If restore settings available, load them
                if (data.restore_settings) {
                    restoreSettings(data.restore_settings);
                }
                
                loadHistory();
            } else {
                authError.textContent = data.message || "Помилка авторизації";
                authError.classList.remove("hidden");
            }
        } catch (err) {
            authError.textContent = "Не вдалося з'єднатися із сервером C++";
            authError.classList.remove("hidden");
        }
    });

    // Logout
    btnLogout.addEventListener("click", async () => {
        if (useClientSideFallback) {
            sessionStorage.removeItem("client_user");
            currentUser = null;
            selectedFilePath = "";
            clientSideFileStore = null;
            manualFilePath.value = "";
            userDisplayName.textContent = "Гість";
            canvasPreview.classList.add("hidden");
            previewPlaceholder.classList.remove("hidden");
            disableControls();
            authOverlay.classList.add("active");
            usernameInput.value = "";
            passwordInput.value = "";
            return;
        }
        try {
            await fetch("/api/logout", { method: "POST" });
        } catch (e) {}
        currentUser = null;
        selectedFilePath = "";
        manualFilePath.value = "";
        userDisplayName.textContent = "Гість";
        canvasPreview.classList.add("hidden");
        previewPlaceholder.classList.remove("hidden");
        disableControls();
        authOverlay.classList.add("active");
        usernameInput.value = "";
        passwordInput.value = "";
    });

    // Sidebar navigation links
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            switchTab(item.getAttribute("data-tab"));
        });
    });

    // File Open Dialog
    btnSelectFile.addEventListener("click", async () => {
        if (!useSystemDialogs.checked) {
            browserFilePicker.click();
            return;
        }
        try {
            const response = await fetch("/api/open-file-dialog", { method: "POST" });
            const data = await response.json();
            if (data.success && data.path) {
                handleFileSelection(data.path);
            } else if (data.reason === "non_interactive") {
                alert("Системні діалоги Windows не можуть бути показані, оскільки сервер запущено у фоновому режимі середовища розробки (IDE).\n\nЗараз буде відкрито браузерний вибір файлів.");
                useSystemDialogs.checked = false;
                browserFilePicker.click();
            }
        } catch (err) {
            console.error("Помилка при виборі файлу", err);
        }
    });

    browserFilePicker.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (useClientSideFallback) {
            manualFilePath.value = file.name;
            try {
                const buffer = await file.arrayBuffer();
                const view = new DataView(buffer);
                if (view.getUint16(0, false) !== 0x424D) { // 'BM'
                    alert("Помилка: файл має бути формату BMP!");
                    manualFilePath.value = "";
                    return;
                }
                if (view.getUint16(28, true) !== 24) {
                    alert("Помилка: BMP має бути 24-бітним!");
                    manualFilePath.value = "";
                    return;
                }
                
                const dataUrl = await fileToDataURL(file);
                clientSideFileStore = {
                    name: file.name,
                    buffer: buffer,
                    dataUrl: dataUrl
                };
                
                selectedFilePath = file.name;
                handleFileSelectionJS();
            } catch (err) {
                alert("Помилка читання файлу: " + err.message);
                manualFilePath.value = "";
            }
            return;
        }

        manualFilePath.value = "Завантаження файлу: " + file.name + "...";
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const response = await fetch("/api/upload-file?name=" + encodeURIComponent(file.name), {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: arrayBuffer
            });
            const data = await response.json();
            if (data.success && data.path) {
                handleFileSelection(data.path);
            } else {
                alert(data.message || "Помилка при завантаженні файлу.");
                manualFilePath.value = "";
            }
        } catch (err) {
            console.error("Помилка завантаження файлу", err);
            alert("Помилка зв'язку із сервером бекенду при завантаженні файлу.");
            manualFilePath.value = "";
        }
    });

    // Manual file path change
    manualFilePath.addEventListener("change", () => {
        if (useClientSideFallback) return;
        const path = manualFilePath.value.trim();
        if (path) {
            handleFileSelection(path);
            fetch("/api/set-active-file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: path })
            }).catch(e => {});
        }
    });

    // Pattern Generator Select change
    generatorMode.addEventListener("change", updateColorComboOptions);

    // Generate BMP button
    btnGenerate.addEventListener("click", async () => {
        if (!selectedFilePath) return;
        
        if (useClientSideFallback) {
            if (!clientSideFileStore) {
                alert("Будь ласка, завантажте BMP файл.");
                return;
            }
            showStatus(generatorStatus, "loading", "Генерація зображення...");
            setTimeout(() => {
                try {
                    const outputBuffer = generatePatternJS(
                        clientSideFileStore.buffer,
                        generatorMode.value,
                        parseInt(colorCombination.value)
                    );
                    
                    const outputBlob = new Blob([outputBuffer], { type: "image/bmp" });
                    const outputFilename = clientSideFileStore.name.replace(/\.bmp$/i, "") + "_generated.bmp";
                    const dataUrl = URL.createObjectURL(outputBlob);
                    
                    clientSideFileStore = {
                        name: outputFilename,
                        buffer: outputBuffer,
                        dataUrl: dataUrl
                    };
                    
                    selectedFilePath = outputFilename;
                    manualFilePath.value = outputFilename;
                    handleFileSelectionJS();
                    
                    const link = document.createElement("a");
                    link.href = dataUrl;
                    link.download = outputFilename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    showStatus(generatorStatus, "success", `Зображення успішно створено та завантажено: ${outputFilename}`);
                    const modeText = generatorMode.value.charAt(0).toUpperCase() + generatorMode.value.slice(1);
                    addHistoryLocal("modes", `${modeText} (Combo ${colorCombination.value})`);
                } catch (err) {
                    showStatus(generatorStatus, "error", "Помилка при генерації: " + err.message);
                }
            }, 300);
            return;
        }

        let outputFilePath = "";
        if (useSystemDialogs.checked) {
            showStatus(generatorStatus, "loading", "Виберіть шлях для збереження файлу...");
            try {
                const saveResp = await fetch("/api/save-file-dialog", { method: "POST" });
                const saveData = await saveResp.json();
                if (saveData.reason === "non_interactive") {
                    alert("Системні діалоги Windows не можуть бути показані в IDE.\n\nФайл буде автоматично збережено та скачано через браузер.");
                    useSystemDialogs.checked = false;
                    outputFilePath = selectedFilePath.replace(/\.bmp$/i, "") + "_generated.bmp";
                } else {
                    outputFilePath = saveData.path;
                    if (!saveData.success || !outputFilePath) {
                        showStatus(generatorStatus, "error", "Збереження скасовано");
                        return;
                    }
                }
            } catch (err) {
                showStatus(generatorStatus, "error", "Помилка виклику діалогу збереження");
                return;
            }
        } else {
            outputFilePath = selectedFilePath.replace(/\.bmp$/i, "") + "_generated.bmp";
        }

        showStatus(generatorStatus, "loading", "Генерація зображення...");
        try {
            const genResp = await fetch("/api/generate-bmp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    input_path: selectedFilePath,
                    output_path: outputFilePath,
                    mode: generatorMode.value,
                    color_combo: parseInt(colorCombination.value)
                })
            });
            const genData = await genResp.json();

            if (genData.success) {
                showStatus(generatorStatus, "success", `Зображення успішно створено та збережено за шляхом: ${outputFilePath}`);
                handleFileSelection(outputFilePath);
                loadHistory();

                if (!useSystemDialogs.checked) {
                    triggerDownload(outputFilePath);
                }
            } else {
                showStatus(generatorStatus, "error", genData.message || "Помилка при генерації");
            }
        } catch (err) {
            showStatus(generatorStatus, "error", "Помилка зв'язку із сервером бекенду");
        }
    });

    // Steganography Tab Selection
    stegoTabEmbed.addEventListener("click", () => {
        stegoTabEmbed.classList.add("active");
        stegoTabExtract.classList.remove("active");
        stegoSectEmbed.classList.remove("hidden");
        stegoSectExtract.classList.add("hidden");
    });
    stegoTabExtract.addEventListener("click", () => {
        stegoTabExtract.classList.add("active");
        stegoTabEmbed.classList.remove("active");
        stegoSectExtract.classList.remove("hidden");
        stegoSectEmbed.classList.add("hidden");
    });

    // LSB Embed Message button
    btnEmbed.addEventListener("click", async () => {
        const message = embedMessage.value.trim();
        if (!selectedFilePath) return;
        if (!message) {
            showStatus(stegoEmbedStatus, "error", "Повідомлення порожнє");
            return;
        }

        if (useClientSideFallback) {
            if (!clientSideFileStore) return;
            showStatus(stegoEmbedStatus, "loading", "Вбудовування повідомлення...");
            setTimeout(() => {
                try {
                    const outputBuffer = embedLSBJS(clientSideFileStore.buffer, message);
                    const outputBlob = new Blob([outputBuffer], { type: "image/bmp" });
                    const outputFilename = clientSideFileStore.name.replace(/\.bmp$/i, "") + "_stego.bmp";
                    const dataUrl = URL.createObjectURL(outputBlob);
                    
                    clientSideFileStore = {
                        name: outputFilename,
                        buffer: outputBuffer,
                        dataUrl: dataUrl
                    };
                    
                    selectedFilePath = outputFilename;
                    manualFilePath.value = outputFilename;
                    handleFileSelectionJS();
                    
                    const link = document.createElement("a");
                    link.href = dataUrl;
                    link.download = outputFilename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    showStatus(stegoEmbedStatus, "success", `Повідомлення успішно приховано у файлі: ${outputFilename}`);
                    embedMessage.value = "";
                    
                    addHistoryLocal("embedded_messages", message);
                } catch (err) {
                    showStatus(stegoEmbedStatus, "error", "Помилка при записі: " + err.message);
                }
            }, 300);
            return;
        }

        let outputFilePath = "";
        if (useSystemDialogs.checked) {
            showStatus(stegoEmbedStatus, "loading", "Виберіть шлях для збереження файлу...");
            try {
                const saveResp = await fetch("/api/save-file-dialog", { method: "POST" });
                const saveData = await saveResp.json();
                if (saveData.reason === "non_interactive") {
                    alert("Системні діалоги Windows не можуть бути показані в IDE.\n\nФайл буде автоматично збережено та скачано через браузер.");
                    useSystemDialogs.checked = false;
                    outputFilePath = selectedFilePath.replace(/\.bmp$/i, "") + "_stego.bmp";
                } else {
                    outputFilePath = saveData.path;
                    if (!saveData.success || !outputFilePath) {
                        showStatus(stegoEmbedStatus, "error", "Збереження скасовано");
                        return;
                    }
                }
            } catch (err) {
                showStatus(stegoEmbedStatus, "error", "Помилка виклику діалогу збереження");
                return;
            }
        } else {
            outputFilePath = selectedFilePath.replace(/\.bmp$/i, "") + "_stego.bmp";
        }

        showStatus(stegoEmbedStatus, "loading", "Вбудовування повідомлення...");
        try {
            const embedResp = await fetch("/api/embed-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    input_path: selectedFilePath,
                    output_path: outputFilePath,
                    message: message
                })
            });
            const embedData = await embedResp.json();

            if (embedData.success) {
                showStatus(stegoEmbedStatus, "success", `Повідомлення успішно приховано у файлі: ${outputFilePath}`);
                embedMessage.value = "";
                handleFileSelection(outputFilePath);
                loadHistory();

                if (!useSystemDialogs.checked) {
                    triggerDownload(outputFilePath);
                }
            } else {
                showStatus(stegoEmbedStatus, "error", embedData.message || "Помилка при записі");
            }
        } catch (err) {
            showStatus(stegoEmbedStatus, "error", "Помилка зв'язку із сервером бекенду");
        }
    });

    // LSB Extract Message button
    btnExtract.addEventListener("click", async () => {
        if (!selectedFilePath) return;
        
        if (useClientSideFallback) {
            if (!clientSideFileStore) return;
            showStatus(stegoExtractStatus, "loading", "Декодування повідомлення з файлу...");
            setTimeout(() => {
                try {
                    const msg = extractLSBJS(clientSideFileStore.buffer);
                    showStatus(stegoExtractStatus, "success", "Декодування завершено успішно");
                    extractedMessage.value = msg;
                    addHistoryLocal("extracted_messages", msg);
                } catch (err) {
                    showStatus(stegoExtractStatus, "error", "Помилка при читанні: " + err.message);
                    extractedMessage.value = "";
                }
            }, 300);
            return;
        }

        showStatus(stegoExtractStatus, "loading", "Декодування повідомлення з файлу...");
        try {
            const extractResp = await fetch("/api/extract-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input_path: selectedFilePath })
            });
            const extractData = await extractResp.json();

            if (extractData.success) {
                showStatus(stegoExtractStatus, "success", "Декодування завершено успішно");
                extractedMessage.value = extractData.message;
                loadHistory();
            } else {
                showStatus(stegoExtractStatus, "error", extractData.message || "Помилка при читанні");
                extractedMessage.value = "";
            }
        } catch (err) {
            showStatus(stegoExtractStatus, "error", "Помилка зв'язку із сервером бекенду");
        }
    });
}

// Restore saved settings on login
function restoreSettings(settings) {
    if (settings.mode) {
        generatorMode.value = settings.mode;
        updateColorComboOptions();
        if (settings.color_combo !== undefined) {
            colorCombination.value = settings.color_combo.toString();
        }
    }
    if (settings.last_file) {
        handleFileSelection(settings.last_file);
    }
}

// Load and display file in workspace
function handleFileSelection(filePath) {
    selectedFilePath = filePath;
    manualFilePath.value = filePath;
    
    // Clear status panels
    generatorStatus.classList.add("hidden");
    stegoEmbedStatus.classList.add("hidden");
    stegoExtractStatus.classList.add("hidden");
    
    // Enable workspace tools
    enableControls();

    // Trigger Canvas load
    previewPlaceholder.classList.add("hidden");
    canvasPreview.classList.remove("hidden");
    
    const ctx = canvasPreview.getContext("2d");
    ctx.clearRect(0, 0, canvasPreview.width, canvasPreview.height);

    const img = new Image();
    img.onload = function() {
        canvasPreview.width = img.width;
        canvasPreview.height = img.height;
        ctx.drawImage(img, 0, 0);
    };
    img.onerror = function() {
        // Fallback display if BMP is corrupted or fails to render in canvas
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(0, 0, 300, 150);
        ctx.font = "14px Outfit";
        ctx.fillStyle = "#f3f4f6";
        ctx.textAlign = "center";
        ctx.fillText("Зображення завантажено", 150, 75);
        ctx.font = "10px monospace";
        ctx.fillStyle = "#9ca3af";
        ctx.fillText(filePath.substring(filePath.lastIndexOf('\\') + 1), 150, 95);
    };
    
    // Append timestamp to avoid browser caching of file preview
    img.src = "/api/get-image?path=" + encodeURIComponent(filePath) + "&t=" + new Date().getTime();
}

function enableControls() {
    btnGenerate.disabled = false;
    btnEmbed.disabled = false;
    btnExtract.disabled = false;
}

function disableControls() {
    btnGenerate.disabled = true;
    btnEmbed.disabled = true;
    btnExtract.disabled = true;
}

function triggerDownload(filePath) {
    const filename = filePath.substring(Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/")) + 1);
    const link = document.createElement("a");
    link.href = "/api/get-image?path=" + encodeURIComponent(filePath);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Show validation status messages
function showStatus(element, type, text) {
    element.className = `status-msg ${type}`;
    element.innerHTML = "";
    
    let icon = "";
    if (type === "success") icon = '<i class="fa-solid fa-circle-check"></i> ';
    if (type === "error") icon = '<i class="fa-solid fa-triangle-exclamation"></i> ';
    if (type === "loading") icon = '<i class="fa-solid fa-circle-notch fa-spin"></i> ';

    element.innerHTML = icon + text;
    element.classList.remove("hidden");
}

// Check session on startup
async function checkSession() {
    try {
        const response = await fetch("/api/check-session");
        const data = await response.json();
        if (data.logged_in && data.username) {
            currentUser = data.username;
            userDisplayName.textContent = currentUser;
            authOverlay.classList.remove("active");
            if (data.restore_settings) {
                restoreSettings(data.restore_settings);
            }
            loadHistory();
        } else {
            authOverlay.classList.add("active");
        }
    } catch (e) {
        enableClientSideFallbackMode();
    }
}

// Load and populate User History
async function loadHistory() {
    try {
        const response = await fetch("/api/get-history");
        const data = await response.json();
        if (data.success && data.history) {
            populateHistoryList(historyFilesList, data.history.bmp_files, (val) => {
                handleFileSelection(val);
                switchTab("workspace");
            });
            populateHistoryList(historyModesList, data.history.modes, (val) => {
                // Apply clicked mode settings
                // Modes are saved like "mode_name (combo_index)"
                const match = val.match(/^(.+?)\s*\(Combo\s*(\d+)\)$/i);
                if (match) {
                    const rawMode = match[1].toLowerCase();
                    let targetMode = "wave";
                    if (rawMode.includes("plasma")) targetMode = "plasma";
                    if (rawMode.includes("bitwise")) targetMode = "bitwise";
                    
                    generatorMode.value = targetMode;
                    updateColorComboOptions();
                    colorCombination.value = match[2];
                    switchTab("workspace");
                }
            });
            populateHistoryList(historyEmbeddedList, data.history.embedded_messages, (val) => {
                stegoTabEmbed.click();
                embedMessage.value = val;
                switchTab("workspace");
            });
            populateHistoryList(historyExtractedList, data.history.extracted_messages, (val) => {
                stegoTabExtract.click();
                extractedMessage.value = val;
                switchTab("workspace");
            });
        }
    } catch (err) {
        console.error("Помилка завантаження історії", err);
    }
}

// Populates list DOM element with clickable items
function populateHistoryList(listElement, items, clickCallback) {
    listElement.innerHTML = "";
    if (!items || items.length === 0) {
        listElement.innerHTML = '<li class="empty-item">Історія порожня</li>';
        return;
    }
    
    items.forEach(item => {
        const li = document.createElement("li");
        // For file paths, display only the filename for a cleaner look
        if (item.includes("\\") || item.includes("/")) {
            const filename = item.substring(Math.max(item.lastIndexOf("\\"), item.lastIndexOf("/")) + 1);
            li.textContent = filename;
            li.title = item;
        } else {
            li.textContent = item;
            li.title = item;
        }
        
        li.addEventListener("click", () => clickCallback(item));
        listElement.appendChild(li);
    });
}

function enableClientSideFallbackMode() {
    useClientSideFallback = true;
    console.log("C++ server offline. Fallback to client-side JS mode active.");
    
    const dialogCheckboxArea = document.querySelector(".dialog-checkbox-area");
    if (dialogCheckboxArea) {
        dialogCheckboxArea.style.display = "none";
    }
    useSystemDialogs.checked = false;
    
    manualFilePath.placeholder = "Оберіть BMP файл через кнопку «Огляд»";
    
    const savedUser = sessionStorage.getItem("client_user");
    if (savedUser) {
        currentUser = savedUser;
        userDisplayName.textContent = currentUser;
        authOverlay.classList.remove("active");
        restoreSettingsJS();
        loadHistoryJS();
    } else {
        authOverlay.classList.add("active");
    }
}

async function handleAuthJS(username, password, isRegisterMode) {
    const users = JSON.parse(localStorage.getItem("users_db") || "[]");
    
    let passwordHash = "";
    try {
        const msgUint8 = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        passwordHash = password;
    }

    if (isRegisterMode) {
        const exists = users.find(u => u.username === username);
        if (exists) {
            authError.textContent = "Користувач вже існує";
            authError.classList.remove("hidden");
            return;
        }
        
        const newUser = {
            username: username,
            passwordHash: passwordHash,
            history: {
                bmp_files: [],
                modes: [],
                embedded_messages: [],
                extracted_messages: []
            },
            settings: {
                mode: "wave",
                color_combo: 0,
                last_file: ""
            }
        };
        users.push(newUser);
        localStorage.setItem("users_db", JSON.stringify(users));
        
        currentUser = username;
        sessionStorage.setItem("client_user", username);
        userDisplayName.textContent = currentUser;
        authOverlay.classList.remove("active");
        loadHistoryJS();
    } else {
        const user = users.find(u => u.username === username && u.passwordHash === passwordHash);
        if (user) {
            currentUser = username;
            sessionStorage.setItem("client_user", username);
            userDisplayName.textContent = currentUser;
            authOverlay.classList.remove("active");
            restoreSettingsJS();
            loadHistoryJS();
        } else {
            authError.textContent = "Невірне ім'я користувача або пароль";
            authError.classList.remove("hidden");
        }
    }
}

function restoreSettingsJS() {
    const users = JSON.parse(localStorage.getItem("users_db") || "[]");
    const user = users.find(u => u.username === currentUser);
    if (user && user.settings) {
        const settings = user.settings;
        if (settings.mode) {
            generatorMode.value = settings.mode;
            updateColorComboOptions();
            if (settings.color_combo !== undefined) {
                colorCombination.value = settings.color_combo.toString();
            }
        }
    }
}

function loadHistoryJS() {
    const users = JSON.parse(localStorage.getItem("users_db") || "[]");
    const user = users.find(u => u.username === currentUser);
    if (user && user.history) {
        populateHistoryList(historyFilesList, user.history.bmp_files, (val) => {
            alert("У автономному режимі файли історії зберігаються як локальні назви. Будь ласка, завантажте оригінальний файл з комп'ютера знову.");
        });
        populateHistoryList(historyModesList, user.history.modes, (val) => {
            const match = val.match(/^(.+?)\s*\(Combo\s*(\d+)\)$/i);
            if (match) {
                const rawMode = match[1].toLowerCase();
                let targetMode = "wave";
                if (rawMode.includes("plasma")) targetMode = "plasma";
                if (rawMode.includes("bitwise")) targetMode = "bitwise";
                
                generatorMode.value = targetMode;
                updateColorComboOptions();
                colorCombination.value = match[2];
                switchTab("workspace");
            }
        });
        populateHistoryList(historyEmbeddedList, user.history.embedded_messages, (val) => {
            stegoTabEmbed.click();
            embedMessage.value = val;
            switchTab("workspace");
        });
        populateHistoryList(historyExtractedList, user.history.extracted_messages, (val) => {
            stegoTabExtract.click();
            extractedMessage.value = val;
            switchTab("workspace");
        });
    }
}

function addHistoryLocal(category, value) {
    const users = JSON.parse(localStorage.getItem("users_db") || "[]");
    const user = users.find(u => u.username === currentUser);
    if (user) {
        if (!user.history[category]) user.history[category] = [];
        const vec = user.history[category];
        const idx = vec.indexOf(value);
        if (idx !== -1) vec.splice(idx, 1);
        vec.unshift(value);
        if (vec.length > 3) vec.length = 3;
        localStorage.setItem("users_db", JSON.stringify(users));
        loadHistoryJS();
    }
}

function saveSettingsLocal(mode, colorCombo, lastFile) {
    const users = JSON.parse(localStorage.getItem("users_db") || "[]");
    const user = users.find(u => u.username === currentUser);
    if (user) {
        user.settings = { mode, color_combo: colorCombo, last_file: lastFile };
        localStorage.setItem("users_db", JSON.stringify(users));
    }
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function handleFileSelectionJS() {
    if (!clientSideFileStore) return;
    generatorStatus.classList.add("hidden");
    stegoEmbedStatus.classList.add("hidden");
    stegoExtractStatus.classList.add("hidden");
    enableControls();
    previewPlaceholder.classList.add("hidden");
    canvasPreview.classList.remove("hidden");
    
    const ctx = canvasPreview.getContext("2d");
    ctx.clearRect(0, 0, canvasPreview.width, canvasPreview.height);
    
    const img = new Image();
    img.onload = function() {
        canvasPreview.width = img.width;
        canvasPreview.height = img.height;
        ctx.drawImage(img, 0, 0);
    };
    img.onerror = function() {
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(0, 0, 300, 150);
        ctx.font = "14px Outfit";
        ctx.fillStyle = "#f3f4f6";
        ctx.textAlign = "center";
        ctx.fillText("Зображення завантажено", 150, 75);
    };
    img.src = clientSideFileStore.dataUrl;
    
    addHistoryLocal("bmp_files", clientSideFileStore.name);
    saveSettingsLocal(generatorMode.value, parseInt(colorCombination.value), clientSideFileStore.name);
}

function generatePatternJS(templateBuffer, mode, colorCombo) {
    const view = new DataView(templateBuffer);
    const width = view.getInt32(18, true);
    const height = Math.abs(view.getInt32(22, true));
    
    const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
    const pixelDataSize = rowSize * height;
    const totalSize = 54 + pixelDataSize;
    
    const outputBuffer = new ArrayBuffer(totalSize);
    const outputView = new DataView(outputBuffer);
    const outputBytes = new Uint8Array(outputBuffer);
    
    const templateBytes = new Uint8Array(templateBuffer);
    outputBytes.set(templateBytes.subarray(0, 54));
    
    outputView.setInt32(2, totalSize, true);
    outputView.setInt32(34, pixelDataSize, true);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const visualY = y;
            const visualX = x;
            
            let intensity = 0;
            if (mode === 'wave') {
                const x1 = 0, y1 = 0;
                const x2 = width / 2, y2 = height;
                const x3 = width, y3 = 0;
                const d1 = Math.sqrt((visualX - x1)**2 + (visualY - y1)**2);
                const d2 = Math.sqrt((visualX - x2)**2 + (visualY - y2)**2);
                const d3 = Math.sqrt((visualX - x3)**2 + (visualY - y3)**2);
                const v = Math.cos(d1 / 15.0) + Math.cos(d2 / 25.0) + Math.cos(d3 / 35.0);
                intensity = Math.floor(((v + 3.0) / 6.0) * 255.0);
            } else if (mode === 'plasma') {
                const v1 = Math.sin(visualX / 16.0);
                const v2 = Math.sin(visualY / 16.0);
                const v3 = Math.sin((visualX + visualY) / 16.0);
                const v4 = Math.sin(Math.sqrt((visualX - width / 2)**2 + (visualY - height / 2)**2) / 16.0);
                const v = (v1 + v2 + v3 + v4) / 4.0;
                intensity = Math.floor(((v + 1.0) / 2.0) * 255.0);
            } else if (mode === 'bitwise') {
                if (colorCombo === 0) {
                    intensity = (visualX ^ visualY) % 256;
                } else if (colorCombo === 1) {
                    intensity = ((visualX * visualY) & (visualX ^ visualY)) % 256;
                } else {
                    intensity = (visualX * visualX + visualY * visualY) & (visualX * visualY) % 256;
                }
            }
            
            let r = 0, g = 0, b = 0;
            if (mode === 'wave') {
                if (colorCombo === 0) {
                    b = intensity; r = 255 - intensity; g = Math.floor(intensity / 2);
                } else if (colorCombo === 1) {
                    r = intensity; g = Math.floor(intensity * 0.7); b = Math.floor(intensity / 4);
                } else {
                    b = intensity; g = Math.floor(intensity * 0.8); r = Math.floor(intensity / 2);
                }
            } else if (mode === 'plasma') {
                if (colorCombo === 0) {
                    r = intensity; g = Math.floor((intensity * intensity) / 255); b = 0;
                } else if (colorCombo === 1) {
                    r = Math.floor(intensity / 3); g = intensity; b = Math.floor(intensity / 2);
                } else {
                    r = Math.floor(Math.sin(intensity * Math.PI / 128.0) * 127.0 + 128.0);
                    g = Math.floor(Math.sin(intensity * Math.PI / 64.0) * 127.0 + 128.0);
                    b = Math.floor(Math.cos(intensity * Math.PI / 128.0) * 127.0 + 128.0);
                }
            } else if (mode === 'bitwise') {
                if (colorCombo === 0) {
                    r = 0; g = intensity; b = 0;
                } else if (colorCombo === 1) {
                    r = intensity; g = intensity; b = intensity;
                } else {
                    r = intensity; g = intensity % 128; b = 255 - intensity;
                }
            }
            
            const pixelIndex = 54 + y * rowSize + x * 3;
            outputBytes[pixelIndex] = b;
            outputBytes[pixelIndex + 1] = g;
            outputBytes[pixelIndex + 2] = r;
        }
    }
    return outputBuffer;
}

function embedLSBJS(templateBuffer, message) {
    const view = new DataView(templateBuffer);
    const width = view.getInt32(18, true);
    const height = Math.abs(view.getInt32(22, true));
    const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
    
    const encoder = new TextEncoder();
    const msgBytes = new Uint8Array(encoder.encode(message + '\0'));
    const bits = [];
    for (let i = 0; i < msgBytes.length; i++) {
        const byte = msgBytes[i];
        for (let b = 0; b < 8; b++) {
            bits.push((byte >> b) & 1);
        }
    }
    
    const outputBuffer = templateBuffer.slice(0);
    const outputBytes = new Uint8Array(outputBuffer);
    
    if (bits.length > width * 3 * height) {
        throw new Error("Повідомлення занадто довге для цього файлу.");
    }
    
    let bitIndex = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width * 3; x++) {
            if (bitIndex >= bits.length) break;
            const pixelByteIndex = 54 + y * rowSize + x;
            const bitVal = bits[bitIndex];
            outputBytes[pixelByteIndex] = (outputBytes[pixelByteIndex] & 0xFE) | bitVal;
            bitIndex++;
        }
        if (bitIndex >= bits.length) break;
    }
    
    return outputBuffer;
}

function extractLSBJS(templateBuffer) {
    const view = new DataView(templateBuffer);
    const width = view.getInt32(18, true);
    const height = Math.abs(view.getInt32(22, true));
    const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
    
    const bytes = [];
    let currentByte = 0;
    let bitIndex = 0;
    const inputBytes = new Uint8Array(templateBuffer);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width * 3; x++) {
            const pixelByteIndex = 54 + y * rowSize + x;
            const bitVal = inputBytes[pixelByteIndex] & 1;
            currentByte |= (bitVal << (bitIndex % 8));
            bitIndex++;
            
            if (bitIndex % 8 === 0) {
                if (currentByte === 0) {
                    const decoder = new TextDecoder();
                    return decoder.decode(new Uint8Array(bytes));
                }
                bytes.push(currentByte);
                currentByte = 0;
            }
        }
    }
    
    throw new Error("Повідомлення не знайдено.");
}
