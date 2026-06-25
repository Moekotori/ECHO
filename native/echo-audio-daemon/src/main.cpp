#include <iostream>
#include <string>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

int main() {
    std::cerr << "echo-audio-daemon ready" << std::endl;

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        try {
            auto request = json::parse(line);
            auto method = request.value("method", "");

            if (method == "shutdown") {
                json response = {
                    {"jsonrpc", "2.0"},
                    {"id", request.value("id", json())},
                    {"result", {{"status", "shutting_down"}}}
                };
                std::cout << response.dump() << std::endl;
                break;
            }

            // Default: method not found
            json errorResp = {
                {"jsonrpc", "2.0"},
                {"id", request.value("id", json())},
                {"error", {{"code", -32601}, {"message", "Method not found"}}}
            };
            std::cout << errorResp.dump() << std::endl;

        } catch (const json::parse_error& e) {
            json errorResp = {
                {"jsonrpc", "2.0"},
                {"id", nullptr},
                {"error", {{"code", -32700}, {"message", "Parse error"}, {"data", e.what()}}}
            };
            std::cout << errorResp.dump() << std::endl;
        }
    }

    return 0;
}
