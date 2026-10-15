#include <fstream>
#include <iostream>
#include <sys/socket.h>
int main() {
    std::ifstream file("/etc/passwd");
    if (file.good()) { std::cerr << "UNEXPECTED_FILE_ACCESS" << std::endl; return 0; }
    std::cerr << "CPP_PASSWD_DENIED" << std::endl;
    socket(AF_INET, SOCK_STREAM, 0);
    return 0;
}
