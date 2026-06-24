#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <commdlg.h>
#include <iostream>
#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <algorithm>
#include <cmath>
#include <direct.h>
#include <cstdint>
#include <thread>
#include <mutex>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "comdlg32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "user32.lib")

// --- Data Structures ---
struct User {
    std::string username;
    std::string password_hash;
    std::string last_file;
    std::string last_mode;
    int last_color_combo = 0;
    std::vector<std::string> bmp_files;
    std::vector<std::string> modes;
    std::vector<std::string> embedded_messages;
    std::vector<std::string> extracted_messages;
};

// --- Global variables ---
std::string start_dir = "";
std::string db_file = "";
std::vector<User> db_users;
std::string current_user = "";
std::mutex db_mutex;

// --- Path and JSON Utilities ---
void normalize_path(std::string& path) {
    std::replace(path.begin(), path.end(), '\\', '/');
}

std::string escape_json_string(const std::string& str) {
    std::string escaped = "";
    for (char c : str) {
        if (c == '\\') {
            escaped += "\\\\";
        } else if (c == '"') {
            escaped += "\\\"";
        } else if (c == '\n') {
            escaped += "\\n";
        } else if (c == '\r') {
            escaped += "\\r";
        } else if (c == '\t') {
            escaped += "\\t";
        } else {
            escaped += c;
        }
    }
    return escaped;
}

// --- JSON Helpers ---
std::string get_json_string_field(const std::string& json, const std::string& field) {
    size_t pos = json.find("\"" + field + "\"");
    if (pos == std::string::npos) return "";
    pos = json.find(":", pos);
    if (pos == std::string::npos) return "";
    size_t start = json.find("\"", pos);
    if (start == std::string::npos) return "";
    size_t end = json.find("\"", start + 1);
    if (end == std::string::npos) return "";
    return json.substr(start + 1, end - start - 1);
}

int get_json_int_field(const std::string& json, const std::string& field) {
    size_t pos = json.find("\"" + field + "\"");
    if (pos == std::string::npos) return 0;
    pos = json.find(":", pos);
    if (pos == std::string::npos) return 0;
    size_t start = json.find_first_of("0123456789-", pos);
    if (start == std::string::npos) return 0;
    size_t end = json.find_first_not_of("0123456789", start + 1);
    try {
        return std::stoi(json.substr(start, end - start));
    } catch (...) {
        return 0;
    }
}

// --- Hashing ---
std::string hash_password(const std::string& password) {
    unsigned long hash = 5381;
    for (char c : password) {
        hash = ((hash << 5) + hash) + c;
    }
    std::stringstream ss;
    ss << std::hex << hash;
    return ss.str();
}

// --- DB Serialization ---
std::string serialize_users(const std::vector<User>& users) {
    std::stringstream ss;
    ss << "[\n";
    for (size_t i = 0; i < users.size(); ++i) {
        const auto& u = users[i];
        ss << "  {\n";
        ss << "    \"username\": \"" << escape_json_string(u.username) << "\",\n";
        ss << "    \"password_hash\": \"" << escape_json_string(u.password_hash) << "\",\n";
        ss << "    \"last_file\": \"" << escape_json_string(u.last_file) << "\",\n";
        ss << "    \"last_mode\": \"" << escape_json_string(u.last_mode) << "\",\n";
        ss << "    \"last_color_combo\": " << u.last_color_combo << ",\n";
        
        auto write_array = [&](const std::string& name, const std::vector<std::string>& vec) {
            ss << "    \"" << name << "\": [";
            for (size_t j = 0; j < vec.size(); ++j) {
                ss << "\"" << escape_json_string(vec[j]) << "\"";
                if (j + 1 < vec.size()) ss << ", ";
            }
            ss << "]";
        };
        
        write_array("bmp_files", u.bmp_files); ss << ",\n";
        write_array("modes", u.modes); ss << ",\n";
        write_array("embedded_messages", u.embedded_messages); ss << ",\n";
        write_array("extracted_messages", u.extracted_messages); ss << "\n";
        ss << "  }";
        if (i + 1 < users.size()) ss << ",";
        ss << "\n";
    }
    ss << "]";
    return ss.str();
}

std::vector<User> deserialize_users(const std::string& content) {
    std::vector<User> users;
    size_t pos = 0;
    while (true) {
        size_t start = content.find("{", pos);
        if (start == std::string::npos) break;
        size_t end = content.find("}", start);
        if (end == std::string::npos) break;
        
        std::string user_str = content.substr(start, end - start + 1);
        User u;
        u.username = get_json_string_field(user_str, "username");
        u.password_hash = get_json_string_field(user_str, "password_hash");
        u.last_file = get_json_string_field(user_str, "last_file");
        u.last_mode = get_json_string_field(user_str, "last_mode");
        u.last_color_combo = get_json_int_field(user_str, "last_color_combo");
        
        auto parse_array = [&](const std::string& name) -> std::vector<std::string> {
            std::vector<std::string> vec;
            size_t a_start = user_str.find("\"" + name + "\":");
            if (a_start == std::string::npos) return vec;
            a_start = user_str.find("[", a_start);
            if (a_start == std::string::npos) return vec;
            size_t a_end = user_str.find("]", a_start);
            if (a_end == std::string::npos) return vec;
            std::string arr_content = user_str.substr(a_start + 1, a_end - a_start - 1);
            
            size_t idx = 0;
            while (true) {
                size_t q1 = arr_content.find("\"", idx);
                if (q1 == std::string::npos) break;
                size_t q2 = arr_content.find("\"", q1 + 1);
                if (q2 == std::string::npos) break;
                vec.push_back(arr_content.substr(q1 + 1, q2 - q1 - 1));
                idx = q2 + 1;
            }
            return vec;
        };
        
        u.bmp_files = parse_array("bmp_files");
        u.modes = parse_array("modes");
        u.embedded_messages = parse_array("embedded_messages");
        u.extracted_messages = parse_array("extracted_messages");
        
        users.push_back(u);
        pos = end + 1;
    }
    return users;
}

void save_db(const std::string& filepath, const std::vector<User>& users) {
    std::string content = serialize_users(users);
    std::ofstream f(filepath, std::ios::out | std::ios::trunc);
    if (f) {
        f << content;
    }
}

void add_to_history(std::vector<std::string>& vec, const std::string& item) {
    auto it = std::find(vec.begin(), vec.end(), item);
    if (it != vec.end()) {
        vec.erase(it);
    }
    vec.insert(vec.begin(), item);
    if (vec.size() > 3) {
        vec.resize(3);
    }
}

// --- BMP Processing using Windows API structs ---
class BMPImage {
public:
    BITMAPFILEHEADER file_header;
    BITMAPINFOHEADER info_header;
    std::vector<uint8_t> pixel_data;

    bool read(const std::string& filename) {
        std::ifstream f(filename, std::ios::binary);
        if (!f) return false;

        f.read(reinterpret_cast<char*>(&file_header), sizeof(file_header));
        if (file_header.bfType != 0x4D42) return false;

        f.read(reinterpret_cast<char*>(&info_header), sizeof(info_header));
        if (info_header.biBitCount != 24) return false;

        f.seekg(file_header.bfOffBits, std::ios::beg);

        size_t data_size = file_header.bfSize - file_header.bfOffBits;
        if (data_size == 0 || data_size > 100 * 1024 * 1024) {
            int width = info_header.biWidth;
            int height = std::abs(info_header.biHeight);
            int row_size = ((width * 3 + 3) / 4) * 4;
            data_size = row_size * height;
        }

        pixel_data.resize(data_size);
        f.read(reinterpret_cast<char*>(pixel_data.data()), data_size);
        return true;
    }

    bool write(const std::string& filename) {
        std::ofstream f(filename, std::ios::binary);
        if (!f) return false;

        f.write(reinterpret_cast<const char*>(&file_header), sizeof(file_header));
        f.write(reinterpret_cast<const char*>(&info_header), sizeof(info_header));
        
        size_t current_pos = sizeof(file_header) + sizeof(info_header);
        if (file_header.bfOffBits > current_pos) {
            std::vector<char> padding(file_header.bfOffBits - current_pos, 0);
            f.write(padding.data(), padding.size());
        }

        f.write(reinterpret_cast<const char*>(pixel_data.data()), pixel_data.size());
        return true;
    }
};

// --- Core Algorithm Logic ---
bool generate_pattern(const std::string& template_path, const std::string& output_path, const std::string& mode, int color_combo) {
    BMPImage img;
    if (!img.read(template_path)) return false;

    int width = img.info_header.biWidth;
    int height = std::abs(img.info_header.biHeight);
    int row_size = ((width * 3 + 3) / 4) * 4;
    int padding_bytes = row_size - (width * 3);

    std::vector<uint8_t> new_pixels(img.pixel_data.size(), 0);

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            int visual_y = (img.info_header.biHeight > 0) ? (height - 1 - y) : y;
            int visual_x = x;

            double val = 0.0;
            uint8_t intensity = 0;

            if (mode == "wave") {
                double x1 = 0, y1 = 0;
                double x2 = width / 2.0, y2 = height;
                double x3 = width, y3 = 0;

                double d1 = std::sqrt((visual_x - x1)*(visual_x - x1) + (visual_y - y1)*(visual_y - y1));
                double d2 = std::sqrt((visual_x - x2)*(visual_x - x2) + (visual_y - y2)*(visual_y - y2));
                double d3 = std::sqrt((visual_x - x3)*(visual_x - x3) + (visual_y - y3)*(visual_y - y3));

                val = std::cos(d1 / 15.0) + std::cos(d2 / 25.0) + std::cos(d3 / 35.0);
                intensity = static_cast<uint8_t>(((val + 3.0) / 6.0) * 255.0);
            } 
            else if (mode == "plasma") {
                double v1 = std::sin(visual_x / 16.0);
                double v2 = std::sin(visual_y / 16.0);
                double v3 = std::sin((visual_x + visual_y) / 16.0);
                double v4 = std::sin(std::sqrt((visual_x - width / 2.0)*(visual_x - width / 2.0) + (visual_y - height / 2.0)*(visual_y - height / 2.0)) / 16.0);
                val = (v1 + v2 + v3 + v4) / 4.0;
                intensity = static_cast<uint8_t>(((val + 1.0) / 2.0) * 255.0);
            } 
            else if (mode == "bitwise") {
                if (color_combo == 0) {
                    intensity = static_cast<uint8_t>((visual_x ^ visual_y) % 256);
                } else if (color_combo == 1) {
                    intensity = static_cast<uint8_t>(((visual_x * visual_y) & (visual_x ^ visual_y)) % 256);
                } else {
                    intensity = static_cast<uint8_t>((visual_x * visual_x + visual_y * visual_y) & (visual_x * visual_y) % 256);
                }
            }

            uint8_t r = 0, g = 0, b = 0;

            if (mode == "wave") {
                if (color_combo == 0) { // Cyberpunk
                    b = intensity;
                    r = 255 - intensity;
                    g = intensity / 2;
                } else if (color_combo == 1) { // Golden
                    r = intensity;
                    g = static_cast<uint8_t>(intensity * 0.7);
                    b = intensity / 4;
                } else { // Deep Sea
                    b = intensity;
                    g = static_cast<uint8_t>(intensity * 0.8);
                    r = intensity / 2;
                }
            } 
            else if (mode == "plasma") {
                if (color_combo == 0) { // Fire
                    r = intensity;
                    g = static_cast<uint8_t>((static_cast<int>(intensity) * intensity) / 255);
                    b = 0;
                } else if (color_combo == 1) { // Aurora
                    r = intensity / 3;
                    g = intensity;
                    b = intensity / 2;
                } else { // Psychedelic
                    r = static_cast<uint8_t>(std::sin(intensity * 3.14159 / 128.0) * 127.0 + 128.0);
                    g = static_cast<uint8_t>(std::sin(intensity * 3.14159 / 64.0) * 127.0 + 128.0);
                    b = static_cast<uint8_t>(std::cos(intensity * 3.14159 / 128.0) * 127.0 + 128.0);
                }
            } 
            else if (mode == "bitwise") {
                if (color_combo == 0) { // Matrix
                    r = 0;
                    g = intensity;
                    b = 0;
                } else if (color_combo == 1) { // Monochrome
                    r = intensity;
                    g = intensity;
                    b = intensity;
                } else { // Purple
                    r = intensity;
                    g = intensity % 128;
                    b = 255 - intensity;
                }
            }

            int pixel_index = y * row_size + x * 3;
            new_pixels[pixel_index] = b;
            new_pixels[pixel_index + 1] = g;
            new_pixels[pixel_index + 2] = r;
        }

        int padding_index = y * row_size + width * 3;
        for (int p = 0; p < padding_bytes; ++p) {
            new_pixels[padding_index + p] = 0;
        }
    }

    img.pixel_data = new_pixels;
    return img.write(output_path);
}

bool embed_lsb(const std::string& template_path, const std::string& output_path, const std::string& message) {
    BMPImage img;
    if (!img.read(template_path)) return false;

    std::string msg = message;
    msg.push_back('\0');

    size_t required_bits = msg.length() * 8;
    int width = img.info_header.biWidth;
    int height = std::abs(img.info_header.biHeight);
    int row_size = ((width * 3 + 3) / 4) * 4;

    size_t embeddable_bytes = width * 3 * height;
    if (required_bits > embeddable_bytes) return false;

    size_t bit_index = 0;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width * 3; ++x) {
            if (bit_index >= required_bits) break;

            int pixel_byte_index = y * row_size + x;
            char current_char = msg[bit_index / 8];
            int bit_val = (current_char >> (bit_index % 8)) & 1;

            img.pixel_data[pixel_byte_index] = (img.pixel_data[pixel_byte_index] & 0xFE) | bit_val;
            bit_index++;
        }
        if (bit_index >= required_bits) break;
    }

    return img.write(output_path);
}

std::string extract_lsb(const std::string& file_path, bool& success) {
    BMPImage img;
    if (!img.read(file_path)) {
        success = false;
        return "";
    }

    int width = img.info_header.biWidth;
    int height = std::abs(img.info_header.biHeight);
    int row_size = ((width * 3 + 3) / 4) * 4;

    std::string message = "";
    char current_char = 0;
    size_t bit_index = 0;

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width * 3; ++x) {
            int pixel_byte_index = y * row_size + x;
            int bit_val = img.pixel_data[pixel_byte_index] & 1;
            
            current_char |= (bit_val << (bit_index % 8));
            bit_index++;

            if (bit_index % 8 == 0) {
                if (current_char == '\0') {
                    success = true;
                    return message;
                }
                message.push_back(current_char);
                current_char = 0;
            }
        }
    }

    success = false;
    return "Error: No hidden message found in this file.";
}

// --- Process Interaction Helper ---
bool is_process_interactive() {
    // Check if running under Antigravity Agent or VSCode terminal background task
    char temp_env[32];
    if (GetEnvironmentVariableA("ANTIGRAVITY_AGENT", temp_env, sizeof(temp_env)) > 0 ||
        GetEnvironmentVariableA("ANTIGRAVITY_CSRF_TOKEN", temp_env, sizeof(temp_env)) > 0) {
        return false;
    }

    HWINSTA hwinsta = GetProcessWindowStation();
    if (hwinsta == NULL) return false;
    USEROBJECTFLAGS uof;
    DWORD lengthNeeded = 0;
    if (GetUserObjectInformationA(hwinsta, UOI_FLAGS, &uof, sizeof(uof), &lengthNeeded)) {
        return (uof.dwFlags & WSF_VISIBLE) != 0;
    }
    return false;
}

// --- Native File Dialog Helpers ---
std::string open_file_dialog() {
    if (!is_process_interactive()) {
        std::cerr << "[WARNING] Process is running in non-interactive background mode. File dialog skipped." << std::endl;
        return "";
    }
    OPENFILENAMEA ofn;
    char szFile[260] = {0};
    ZeroMemory(&ofn, sizeof(ofn));
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = NULL;
    ofn.lpstrFile = szFile;
    ofn.nMaxFile = sizeof(szFile);
    ofn.lpstrFilter = "BMP Files (*.bmp)\0*.bmp\0All Files (*.*)\0*.*\0";
    ofn.nFilterIndex = 1;
    ofn.lpstrFileTitle = NULL;
    ofn.nMaxFileTitle = 0;
    ofn.lpstrInitialDir = NULL;
    ofn.Flags = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR;

    if (GetOpenFileNameA(&ofn) == TRUE) {
        std::string path = ofn.lpstrFile;
        normalize_path(path);
        return path;
    }
    return "";
}

std::string save_file_dialog() {
    if (!is_process_interactive()) {
        std::cerr << "[WARNING] Process is running in non-interactive background mode. Save dialog skipped." << std::endl;
        return "";
    }
    OPENFILENAMEA ofn;
    char szFile[260] = {0};
    ZeroMemory(&ofn, sizeof(ofn));
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = NULL;
    ofn.lpstrFile = szFile;
    ofn.nMaxFile = sizeof(szFile);
    ofn.lpstrFilter = "BMP Files (*.bmp)\0*.bmp\0";
    ofn.nFilterIndex = 1;
    ofn.lpstrFileTitle = NULL;
    ofn.nMaxFileTitle = 0;
    ofn.lpstrInitialDir = NULL;
    ofn.Flags = OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR;

    if (GetSaveFileNameA(&ofn) == TRUE) {
        std::string path = ofn.lpstrFile;
        if (path.length() < 4 || path.substr(path.length() - 4) != ".bmp") {
            path += ".bmp";
        }
        normalize_path(path);
        return path;
    }
    return "";
}

// --- HTTP Server Infrastructure ---
std::string decode_url(const std::string& url) {
    std::string decoded = "";
    for (size_t i = 0; i < url.length(); ++i) {
        if (url[i] == '%') {
            if (i + 2 < url.length()) {
                char hex[3] = { url[i+1], url[i+2], '\0' };
                decoded += static_cast<char>(std::strtol(hex, NULL, 16));
                i += 2;
            }
        } else if (url[i] == '+') {
            decoded += ' ';
        } else {
            decoded += url[i];
        }
    }
    return decoded;
}

std::string get_query_param(const std::string& url, const std::string& param) {
    size_t pos = url.find(param + "=");
    if (pos == std::string::npos) return "";
    size_t start = pos + param.length() + 1;
    size_t end = url.find("&", start);
    std::string val;
    if (end == std::string::npos) {
        val = url.substr(start);
    } else {
        val = url.substr(start, end - start);
    }
    return decode_url(val);
}

std::string get_content_type(const std::string& path) {
    if (path.find(".html") != std::string::npos) return "text/html; charset=utf-8";
    if (path.find(".css") != std::string::npos) return "text/css; charset=utf-8";
    if (path.find(".js") != std::string::npos) return "application/javascript; charset=utf-8";
    if (path.find(".bmp") != std::string::npos) return "image/bmp";
    return "application/octet-stream";
}

std::string read_file_to_string(const std::string& path) {
    std::ifstream f(path, std::ios::in | std::ios::binary);
    if (!f) return "";
    std::string str((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    return str;
}

std::vector<uint8_t> read_file_to_binary(const std::string& path) {
    std::ifstream f(path, std::ios::in | std::ios::binary);
    if (!f) return {};
    return std::vector<uint8_t>((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

void send_response(SOCKET client, const std::string& status, const std::string& content_type, const std::string& body) {
    std::stringstream ss;
    ss << "HTTP/1.1 " << status << "\r\n";
    ss << "Content-Type: " << content_type << "\r\n";
    ss << "Content-Length: " << body.length() << "\r\n";
    ss << "Connection: close\r\n\r\n";
    ss << body;
    
    std::string response = ss.str();
    send(client, response.c_str(), static_cast<int>(response.length()), 0);
}

void send_binary_response(SOCKET client, const std::string& status, const std::string& content_type, const std::vector<uint8_t>& body) {
    std::stringstream ss;
    ss << "HTTP/1.1 " << status << "\r\n";
    ss << "Content-Type: " << content_type << "\r\n";
    ss << "Content-Length: " << body.size() << "\r\n";
    ss << "Connection: close\r\n\r\n";
    
    std::string header = ss.str();
    send(client, header.c_str(), static_cast<int>(header.length()), 0);
    send(client, reinterpret_cast<const char*>(body.data()), static_cast<int>(body.size()), 0);
}

std::string recv_http(SOCKET client, std::string& body) {
    std::string request = "";
    char buf[2048];
    size_t header_end = std::string::npos;
    
    while (header_end == std::string::npos) {
        int bytes = recv(client, buf, sizeof(buf) - 1, 0);
        if (bytes <= 0) break;
        buf[bytes] = '\0';
        request.append(buf, bytes);
        header_end = request.find("\r\n\r\n");
    }
    
    if (header_end == std::string::npos) return request;
    
    std::string headers = request.substr(0, header_end);
    std::string temp_body = request.substr(header_end + 4);
    
    size_t cl_pos = headers.find("Content-Length:");
    size_t content_length = 0;
    if (cl_pos != std::string::npos) {
        size_t start = headers.find_first_of("0123456789", cl_pos);
        size_t end = headers.find_first_not_of("0123456789", start);
        content_length = std::stoul(headers.substr(start, end - start));
    }
    
    while (temp_body.length() < content_length) {
        int to_recv = static_cast<int>(content_length - temp_body.length());
        int bytes = recv(client, buf, (to_recv < 2048) ? to_recv : 2048, 0);
        if (bytes <= 0) break;
        temp_body.append(buf, bytes);
    }
    
    body = temp_body;
    return headers;
}

// --- Client Thread Handler ---
void handle_client(SOCKET client_socket) {
    // Set a brief receive timeout to prevent speculative browser connections from freezing the thread
    DWORD timeout = 2000; // 2s
    setsockopt(client_socket, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout));

    std::string body = "";
    std::string headers = recv_http(client_socket, body);
    if (headers.empty()) {
        closesocket(client_socket);
        return;
    }

    std::stringstream ss(headers);
    std::string method, path, version;
    ss >> method >> path >> version;

    size_t query_pos = path.find("?");
    std::string clean_path = (query_pos == std::string::npos) ? path : path.substr(0, query_pos);

    // Thread safety lock for user profile mutations
    bool is_api_db = (clean_path.find("/api/") == 0 && clean_path != "/api/get-image");
    std::unique_lock<std::mutex> lock(db_mutex, std::defer_lock);
    if (is_api_db) {
        lock.lock();
    }

    if (clean_path == "/" || clean_path == "/index.html") {
        std::string content = read_file_to_string(start_dir + "/web/index.html");
        send_response(client_socket, "200 OK", "text/html; charset=utf-8", content);
    }
    else if (clean_path == "/style.css") {
        std::string content = read_file_to_string(start_dir + "/web/style.css");
        send_response(client_socket, "200 OK", "text/css; charset=utf-8", content);
    }
    else if (clean_path == "/app.js") {
        std::string content = read_file_to_string(start_dir + "/web/app.js");
        send_response(client_socket, "200 OK", "application/javascript; charset=utf-8", content);
    }
    else if (clean_path == "/api/get-image") {
        std::string image_path = get_query_param(path, "path");
        std::vector<uint8_t> binary = read_file_to_binary(image_path);
        if (!binary.empty()) {
            send_binary_response(client_socket, "200 OK", "image/bmp", binary);
        } else {
            send_response(client_socket, "404 Not Found", "text/plain", "Image not found");
        }
    }
    else if (clean_path == "/api/check-session") {
        std::stringstream resp;
        resp << "{\n";
        if (!current_user.empty()) {
            resp << "  \"logged_in\": true,\n";
            resp << "  \"username\": \"" << current_user << "\",\n";
            
            auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == current_user; });
            if (u_it != db_users.end()) {
                resp << "  \"restore_settings\": {\n";
                resp << "    \"mode\": \"" << u_it->last_mode << "\",\n";
                resp << "    \"color_combo\": " << u_it->last_color_combo << ",\n";
                resp << "    \"last_file\": \"" << u_it->last_file << "\"\n";
                resp << "  }\n";
            } else {
                resp << "  \"restore_settings\": null\n";
            }
        } else {
            resp << "  \"logged_in\": false\n";
        }
        resp << "}";
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else if (clean_path == "/api/login") {
        std::string user = get_json_string_field(body, "username");
        std::string pass = get_json_string_field(body, "password");
        std::string hashed = hash_password(pass);

        auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == user; });
        
        std::stringstream resp;
        if (u_it != db_users.end() && u_it->password_hash == hashed) {
            current_user = user;
            resp << "{\n";
            resp << "  \"success\": true,\n";
            resp << "  \"username\": \"" << current_user << "\",\n";
            resp << "  \"restore_settings\": {\n";
            resp << "    \"mode\": \"" << u_it->last_mode << "\",\n";
            resp << "    \"color_combo\": " << u_it->last_color_combo << ",\n";
            resp << "    \"last_file\": \"" << u_it->last_file << "\"\n";
            resp << "  }\n";
            resp << "}";
            send_response(client_socket, "200 OK", "application/json", resp.str());
        } else {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"message\": \"Невірне ім'я користувача або пароль\"\n";
            resp << "}";
            send_response(client_socket, "401 Unauthorized", "application/json", resp.str());
        }
    }
    else if (clean_path == "/api/register") {
        std::string user = get_json_string_field(body, "username");
        std::string pass = get_json_string_field(body, "password");
        
        auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == user; });
        
        std::stringstream resp;
        if (user.empty() || pass.empty()) {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"message\": \"Логін та пароль не можуть бути порожніми\"\n";
            resp << "}";
            send_response(client_socket, "400 Bad Request", "application/json", resp.str());
        }
        else if (u_it != db_users.end()) {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"message\": \"Користувач вже існує\"\n";
            resp << "}";
            send_response(client_socket, "400 Bad Request", "application/json", resp.str());
        } else {
            User new_u;
            new_u.username = user;
            new_u.password_hash = hash_password(pass);
            new_u.last_mode = "wave";
            new_u.last_color_combo = 0;
            db_users.push_back(new_u);
            save_db(db_file, db_users);
            
            current_user = user;
            resp << "{\n";
            resp << "  \"success\": true,\n";
            resp << "  \"username\": \"" << current_user << "\"\n";
            resp << "}";
            send_response(client_socket, "200 OK", "application/json", resp.str());
        }
    }
    else if (clean_path == "/api/logout") {
        current_user = "";
        send_response(client_socket, "200 OK", "application/json", "{\"success\":true}");
    }
    else if (clean_path == "/api/open-file-dialog") {
        std::stringstream resp;
        if (!is_process_interactive()) {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"reason\": \"non_interactive\"\n";
            resp << "}";
        } else {
            std::string filepath = open_file_dialog();
            if (!filepath.empty()) {
                resp << "{\n";
                resp << "  \"success\": true,\n";
                resp << "  \"path\": \"" << escape_json_string(filepath) << "\"\n";
                resp << "}";
                
                if (!current_user.empty()) {
                    auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == current_user; });
                    if (u_it != db_users.end()) {
                        u_it->last_file = filepath;
                        add_to_history(u_it->bmp_files, filepath);
                        save_db(db_file, db_users);
                    }
                }
            } else {
                resp << "{\"success\": false}";
            }
        }
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else if (clean_path == "/api/upload-file") {
        std::string filename = get_query_param(path, "name");
        if (filename.empty()) filename = "temp_uploaded.bmp";
        
        // Sanitize filename to prevent directory traversal
        filename.erase(std::remove_if(filename.begin(), filename.end(), [](char c) {
            return c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '\"' || c == '<' || c == '>' || c == '|';
        }), filename.end());

        _mkdir((start_dir + "/uploads").c_str());
        std::string full_path = start_dir + "/uploads/" + filename;
        normalize_path(full_path);
        
        std::ofstream f(full_path, std::ios::out | std::ios::binary);
        bool ok = false;
        if (f) {
            f.write(body.data(), body.size());
            f.close();
            ok = true;
        }
        
        std::stringstream resp;
        if (ok) {
            resp << "{\n";
            resp << "  \"success\": true,\n";
            resp << "  \"path\": \"" << escape_json_string(full_path) << "\"\n";
            resp << "}";
            
            if (!current_user.empty()) {
                auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == current_user; });
                if (u_it != db_users.end()) {
                    u_it->last_file = full_path;
                    add_to_history(u_it->bmp_files, full_path);
                    save_db(db_file, db_users);
                }
            }
        } else {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"message\": \"Не вдалося зберегти завантажений файл.\"\n";
            resp << "}";
        }
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else if (clean_path == "/api/set-active-file") {
        std::string filepath = get_json_string_field(body, "path");
        normalize_path(filepath);
        std::stringstream resp;
        if (!filepath.empty()) {
            resp << "{\"success\": true}";
            if (!current_user.empty()) {
                auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == current_user; });
                if (u_it != db_users.end()) {
                    u_it->last_file = filepath;
                    add_to_history(u_it->bmp_files, filepath);
                    save_db(db_file, db_users);
                }
            }
        } else {
            resp << "{\"success\": false}";
        }
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else if (clean_path == "/api/save-file-dialog") {
        std::stringstream resp;
        if (!is_process_interactive()) {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"reason\": \"non_interactive\"\n";
            resp << "}";
        } else {
            std::string filepath = save_file_dialog();
            if (!filepath.empty()) {
                resp << "{\n";
                resp << "  \"success\": true,\n";
                resp << "  \"path\": \"" << escape_json_string(filepath) << "\"\n";
                resp << "}";
            } else {
                resp << "{\"success\": false}";
            }
        }
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else if (clean_path == "/api/generate-bmp") {
        std::string input_path = get_json_string_field(body, "input_path");
        std::string output_path = get_json_string_field(body, "output_path");
        std::string mode = get_json_string_field(body, "mode");
        int color_combo = get_json_int_field(body, "color_combo");

        normalize_path(input_path);
        normalize_path(output_path);

        bool ok = generate_pattern(input_path, output_path, mode, color_combo);
        std::stringstream resp;
        if (ok) {
            resp << "{\"success\": true}";
            
            if (!current_user.empty()) {
                auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == current_user; });
                if (u_it != db_users.end()) {
                    u_it->last_file = output_path;
                    u_it->last_mode = mode;
                    u_it->last_color_combo = color_combo;
                    add_to_history(u_it->bmp_files, output_path);
                    
                    std::string mode_str = mode;
                    mode_str[0] = std::toupper(mode_str[0]);
                    add_to_history(u_it->modes, mode_str + " (Combo " + std::to_string(color_combo) + ")");
                    save_db(db_file, db_users);
                }
            }
        } else {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"message\": \"Помилка генерації зображення. Перевірте формат файлу шаблону (має бути 24-бітний BMP).\"\n";
            resp << "}";
        }
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else if (clean_path == "/api/embed-message") {
        std::string input_path = get_json_string_field(body, "input_path");
        std::string output_path = get_json_string_field(body, "output_path");
        std::string message = get_json_string_field(body, "message");

        normalize_path(input_path);
        normalize_path(output_path);

        bool ok = embed_lsb(input_path, output_path, message);
        std::stringstream resp;
        if (ok) {
            resp << "{\"success\": true}";
            if (!current_user.empty()) {
                auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == current_user; });
                if (u_it != db_users.end()) {
                    u_it->last_file = output_path;
                    add_to_history(u_it->bmp_files, output_path);
                    add_to_history(u_it->embedded_messages, message);
                    save_db(db_file, db_users);
                }
            }
        } else {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"message\": \"Помилка при записі повідомлення. Можливо, повідомлення задовге для цього файлу.\"\n";
            resp << "}";
        }
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else if (clean_path == "/api/extract-message") {
        std::string input_path = get_json_string_field(body, "input_path");
        normalize_path(input_path);
        bool ok = false;
        std::string msg = extract_lsb(input_path, ok);
        std::stringstream resp;
        if (ok) {
            resp << "{\n";
            resp << "  \"success\": true,\n";
            resp << "  \"message\": \"" << escape_json_string(msg) << "\"\n";
            resp << "}";
            if (!current_user.empty()) {
                auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == current_user; });
                if (u_it != db_users.end()) {
                    add_to_history(u_it->extracted_messages, msg);
                    save_db(db_file, db_users);
                }
            }
        } else {
            resp << "{\n";
            resp << "  \"success\": false,\n";
            resp << "  \"message\": \"" << escape_json_string(msg) << "\"\n";
            resp << "}";
        }
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else if (clean_path == "/api/get-history") {
        std::stringstream resp;
        if (!current_user.empty()) {
            auto u_it = std::find_if(db_users.begin(), db_users.end(), [&](const User& u) { return u.username == current_user; });
            if (u_it != db_users.end()) {
                resp << "{\n";
                resp << "  \"success\": true,\n";
                resp << "  \"history\": {\n";
                
                auto write_array = [&](const std::string& name, const std::vector<std::string>& vec) {
                    resp << "    \"" << name << "\": [";
                    for (size_t j = 0; j < vec.size(); ++j) {
                        resp << "\"" << escape_json_string(vec[j]) << "\"";
                        if (j + 1 < vec.size()) resp << ", ";
                    }
                    resp << "]";
                };
                
                write_array("bmp_files", u_it->bmp_files); resp << ",\n";
                write_array("modes", u_it->modes); resp << ",\n";
                write_array("embedded_messages", u_it->embedded_messages); resp << ",\n";
                write_array("extracted_messages", u_it->extracted_messages); resp << "\n";
                resp << "  }\n";
                resp << "}";
            } else {
                resp << "{\"success\": false}";
            }
        } else {
            resp << "{\"success\": false, \"message\": \"Not logged in\"}";
        }
        send_response(client_socket, "200 OK", "application/json", resp.str());
    }
    else {
        send_response(client_socket, "404 Not Found", "text/plain", "Page not found");
    }

    closesocket(client_socket);
}

// --- Automated Test Mode ---
bool create_dummy_bmp(const std::string& filename, int width, int height) {
    BITMAPFILEHEADER bfh;
    BITMAPINFOHEADER bih;
    
    int row_size = ((width * 3 + 3) / 4) * 4;
    int pixel_data_size = row_size * height;
    
    bfh.bfType = 0x4D42;
    bfh.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
    bfh.bfSize = bfh.bfOffBits + pixel_data_size;
    bfh.bfReserved1 = 0;
    bfh.bfReserved2 = 0;
    
    bih.biSize = sizeof(BITMAPINFOHEADER);
    bih.biWidth = width;
    bih.biHeight = height;
    bih.biPlanes = 1;
    bih.biBitCount = 24;
    bih.biCompression = BI_RGB;
    bih.biSizeImage = pixel_data_size;
    bih.biXPelsPerMeter = 0;
    bih.biYPelsPerMeter = 0;
    bih.biClrUsed = 0;
    bih.biClrImportant = 0;
    
    std::vector<uint8_t> pixels(pixel_data_size, 128); // gray pixels
    
    std::ofstream f(filename, std::ios::binary);
    if (!f) return false;
    f.write(reinterpret_cast<char*>(&bfh), sizeof(bfh));
    f.write(reinterpret_cast<char*>(&bih), sizeof(bih));
    f.write(reinterpret_cast<char*>(pixels.data()), pixels.size());
    return true;
}

void run_tests() {
    std::cout << "=== RUNNING AUTOMATED TESTS ===" << std::endl;
    bool all_passed = true;

    // Test 1: BMP creation, read and write
    std::string test_bmp = "test_temp.bmp";
    if (create_dummy_bmp(test_bmp, 16, 16)) {
        std::cout << "[PASS] Test 1.1: Created dummy BMP file." << std::endl;
    } else {
        std::cout << "[FAIL] Test 1.1: Failed to create dummy BMP file." << std::endl;
        all_passed = false;
    }

    BMPImage img;
    if (img.read(test_bmp)) {
        if (img.info_header.biWidth == 16 && std::abs(img.info_header.biHeight) == 16 && img.info_header.biBitCount == 24) {
            std::cout << "[PASS] Test 1.2: Read BMP and verified dimensions." << std::endl;
        } else {
            std::cout << "[FAIL] Test 1.2: Dimensions or bit count mismatch." << std::endl;
            all_passed = false;
        }
    } else {
        std::cout << "[FAIL] Test 1.2: Failed to read BMP file." << std::endl;
        all_passed = false;
    }

    // Test 2: Steganography LSB
    std::string test_stego = "test_stego.bmp";
    std::string secret_msg = "Secret message! Slava Ukraini! 12345";
    if (embed_lsb(test_bmp, test_stego, secret_msg)) {
        std::cout << "[PASS] Test 2.1: Embedded secret message using LSB." << std::endl;
    } else {
        std::cout << "[FAIL] Test 2.1: Failed to embed secret message." << std::endl;
        all_passed = false;
    }

    bool extract_ok = false;
    std::string extracted = extract_lsb(test_stego, extract_ok);
    if (extract_ok && extracted == secret_msg) {
        std::cout << "[PASS] Test 2.2: Extracted secret message and it matches exactly." << std::endl;
    } else {
        std::cout << "[FAIL] Test 2.2: Extracted message mismatch. Extracted: " << extracted << std::endl;
        all_passed = false;
    }

    // Test 3: Pattern generation (Wave Interference, Plasma, Bitwise)
    std::string test_pattern = "test_pattern.bmp";
    if (generate_pattern(test_bmp, test_pattern, "plasma", 1)) {
        BMPImage pat_img;
        if (pat_img.read(test_pattern) && pat_img.info_header.biWidth == 16) {
            std::cout << "[PASS] Test 3.1: Generated Plasma pattern." << std::endl;
        } else {
            std::cout << "[FAIL] Test 3.1: Pattern generation output is invalid." << std::endl;
            all_passed = false;
        }
    } else {
        std::cout << "[FAIL] Test 3.1: Pattern generation failed." << std::endl;
        all_passed = false;
    }

    // Test 4: User authentication and DB serialization
    std::vector<User> test_users;
    User u1;
    u1.username = "testuser";
    u1.password_hash = hash_password("testpass");
    u1.last_mode = "plasma";
    u1.last_color_combo = 1;
    u1.bmp_files = {"file1.bmp", "file2.bmp"};
    u1.modes = {"Plasma (Combo 1)"};
    test_users.push_back(u1);

    std::string serialized = serialize_users(test_users);
    std::vector<User> deserialized = deserialize_users(serialized);
    if (deserialized.size() == 1 && deserialized[0].username == "testuser" && deserialized[0].password_hash == hash_password("testpass")) {
        if (deserialized[0].bmp_files.size() == 2 && deserialized[0].bmp_files[0] == "file1.bmp" && deserialized[0].modes[0] == "Plasma (Combo 1)") {
            std::cout << "[PASS] Test 4.1: Serialized and deserialized user DB successfully." << std::endl;
        } else {
            std::cout << "[FAIL] Test 4.1: User history array mismatch." << std::endl;
            all_passed = false;
        }
    } else {
        std::cout << "[FAIL] Test 4.1: User credentials mismatch." << std::endl;
        all_passed = false;
    }

    // Clean up
    DeleteFileA(test_bmp.c_str());
    DeleteFileA(test_stego.c_str());
    DeleteFileA(test_pattern.c_str());

    std::cout << "===============================" << std::endl;
    if (all_passed) {
        std::cout << "ALL TESTS PASSED SUCCESSFULLY!" << std::endl;
    } else {
        std::cout << "SOME TESTS FAILED!" << std::endl;
        exit(1);
    }
}

// --- Main Program Entry ---
int main(int argc, char* argv[]) {
    if (argc > 1 && std::string(argv[1]) == "--test") {
        run_tests();
        return 0;
    }

    SetConsoleCP(65001);
    SetConsoleOutputCP(65001);

    char current_work_dir[FILENAME_MAX];
    if (_getcwd(current_work_dir, sizeof(current_work_dir))) {
        start_dir = std::string(current_work_dir);
    }

    _mkdir((start_dir + "/uploads").c_str());

    db_file = start_dir + "/users.json";

    // Load users from DB
    {
        std::string content = read_file_to_string(db_file);
        if (!content.empty()) {
            db_users = deserialize_users(content);
        }
    }

    // Initialize Winsock
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        std::cerr << "WSAStartup failed." << std::endl;
        return 1;
    }

    SOCKET listen_socket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_socket == INVALID_SOCKET) {
        std::cerr << "Socket creation failed." << std::endl;
        WSACleanup();
        return 1;
    }

    int opt = 1;
    setsockopt(listen_socket, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&opt), sizeof(opt));

    sockaddr_in server_addr;
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;

    int port = 8080;
    while (true) {
        server_addr.sin_port = htons(port);
        if (bind(listen_socket, reinterpret_cast<sockaddr*>(&server_addr), sizeof(server_addr)) != SOCKET_ERROR) {
            break;
        }
        port++;
        if (port > 8100) {
            std::cerr << "Could not bind to any port in range 8080-8100." << std::endl;
            closesocket(listen_socket);
            WSACleanup();
            return 1;
        }
    }

    if (listen(listen_socket, SOMAXCONN) == SOCKET_ERROR) {
        std::cerr << "Listen failed." << std::endl;
        closesocket(listen_socket);
        WSACleanup();
        return 1;
    }

    std::string url = "http://localhost:" + std::to_string(port);
    std::cout << "HTTP Server running on " << url << std::endl;
    
    // Automatically open user browser
    ShellExecuteA(NULL, "open", url.c_str(), NULL, NULL, SW_SHOWNORMAL);

    // Client accept loop (Spawns a new thread for each connection)
    while (true) {
        SOCKET client_socket = accept(listen_socket, NULL, NULL);
        if (client_socket == INVALID_SOCKET) continue;

        std::thread t(handle_client, client_socket);
        t.detach();
    }

    closesocket(listen_socket);
    WSACleanup();
    return 0;
}
