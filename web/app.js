// State management
let currentUser = null;
let selectedFilePath = "";

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
                // Automatically switch to the newly created file as our template/workspace
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
                // Switch workspace to the new steganographic file
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
        authOverlay.classList.add("active");
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
