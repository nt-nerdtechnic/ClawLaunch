# Promoting International Collaboration (Contributing Guide)

Thank you for your interest in NT-ClawLaunch! We highly value community participation. Below are the basic principles and steps for contributing.

## 🐞 How to Report a Bug?

If you find a bug, please first search for existing reports in [GitHub Issues](https://github.com/nt-nerdtechnic/NT-ClawLaunch/issues). If none exist, please open a new Issue and provide:
*   **A concise title:** Describing the specific problem.
*   **Steps to reproduce:** How can this error be triggered again?
*   **Expected vs. Actual behavior:** What did you expect to happen, and what actually happened?
*   **Environment information:** OS version, Node.js version, etc.

## 💡 Feature Suggestions

Have a great idea? Please initiate a discussion in an Issue first, allowing maintainers and the community to evaluate feasibility and direction.

## 💻 Development Workflow

1.  **Fork the Repository:** Fork the project to your personal GitHub account.
2.  **Create a Branch:** All development should take place on independent Feature or Bugfix branches.
    ```bash
    git checkout -b feature/your-awesome-feature
    ```
3.  **Adhere to Code Standards:** This project uses ESLint and Prettier. Please run the following before submitting:
    ```bash
    pnpm lint
    ```
4.  **Submit a Pull Request (PR):**
    *   Describe what problem your changes solve.
    *   Ensure all tests pass.
    *   PR titles should follow the Conventional Commits specification (e.g., `feat: add autonomous navigation`).

## 🛠 Environment Setup

Please refer to the Quick Start section in `README.en.md`. If you need to modify back-end logic, ensure that the Rust toolchain is installed on your system.

---

Thank you for your contributions to making NT-ClawLaunch better!
