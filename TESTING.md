# MockNest Testing Guide

This document provides a step-by-step guide to manually test all features of the MockNest VS Code extension.

## Prerequisites

1.  **Build the project:** Ensure all packages are compiled by running `npm run build` from the project root.
2.  **Create a Test Workspace:** You need a separate, clean workspace to test the extension.
    ```bash
    # Run this from your home directory or any other location outside the mocknest project
    mkdir my-api-project
    cd my-api-project
    # Copy the sample spec file into your new test project
    cp /path/to/mocknest/examples/openapi.yaml ./openapi.yaml
    ```

## Launching the Extension for Testing

1.  Open the `mocknest` source code project in VS Code.
2.  Go to the **Run and Debug** view.
3.  Select **"Run MockNest Extension"** from the dropdown and press `F5`.
4.  A new **[Extension Development Host]** window will appear.
5.  In this new window, use `File > Open Folder...` to open the `my-api-project` folder you created above.

You are now ready to test the features.

---

## Feature Checklist and Test Cases

### 1. Extension Activation & UI Elements

-   **Feature:** The extension activates when a workspace contains an `openapi.yaml` file. The MockNest icon appears in the activity bar, and a status bar item is visible.
-   **Test Steps:**
    1.  After opening `my-api-project` in the Extension Host, look for the MockNest server icon in the activity bar on the left.
    2.  Look for the `$(circle-slash) MockNest: OFF` text in the status bar at the bottom-right.
-   **Expected Result:** Both the activity bar icon and the status bar item are present.

### 2. Command: `MockNest: Select OpenAPI Spec File`

-   **Feature:** Allows the user to manually select the OpenAPI specification file to use.
-   **Test Steps:**
    1.  Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`).
    2.  Type `MockNest` and select `MockNest: Select OpenAPI Spec File`.
    3.  A file picker should appear, showing `openapi.yaml`. Select it.
-   **Expected Result:** No immediate visible change, but the extension now knows which file to use for the server.

### 3. Command: `MockNest: Start Mock Server`

-   **Feature:** Starts the mock API server based on the selected OpenAPI spec.
-   **Test Steps:**
    1.  Open the Command Palette and select `MockNest: Start Mock Server`.
-   **Expected Result:**
    1.  An information message "MockNest running on http://localhost:3001" appears.
    2.  The status bar item changes to `$(play) MockNest: ON :3001`.
    3.  The "Mock Routes" view in the MockNest sidebar populates with a list of API routes (e.g., `GET /health`, `GET /users`, etc.).

### 4. Mock Server Endpoint Validation

-   **Feature:** The running server correctly responds to requests for defined routes with generated fake data.
-   **Test Steps:** Open a terminal (separate from VS Code) and run the following `curl` commands.

    **GET Request (Simple):**
    ```bash
    curl -i http://localhost:3001/health
    ```
    *Expected Result:* `HTTP/1.1 200 OK` with a JSON body containing fake data for `status`, `version`, and `timestamp`.

    **GET Request (Array Response):**
    ```bash
    curl -i http://localhost:3001/users
    ```
    *Expected Result:* `HTTP/1.1 200 OK` with a JSON body containing an array of user objects.

    **GET Request (Path Parameter):**
    ```bash
    curl -i http://localhost:3001/users/some-id-123
    ```
    *Expected Result:* `HTTP/1.1 200 OK` with a JSON body for a single user object.

    **POST Request:**
    ```bash
    curl -i -X POST http://localhost:3001/orders \
    -H "Content-Type: application/json" \
    -d '{"userId": "user123", "amount": 100, "currency": "USD"}'
    ```
    *Expected Result:* `HTTP/1.1 201 Created` with a JSON body representing the created order.

    **HEAD Request:**
    ```bash
    curl -I http://localhost:3001/metrics
    ```
    *Expected Result:* `HTTP/1.1 204 No Content` with no response body.

    **404 Not Found:**
    ```bash
    curl -i http://localhost:3001/this-route-does-not-exist
    ```
    *Expected Result:* `HTTP/1.1 404 Not Found` with an error JSON body.

### 5. Command: `MockNest: Stop Mock Server`

-   **Feature:** Stops the running mock API server.
-   **Test Steps:**
    1.  Open the Command Palette and select `MockNest: Stop Mock Server`.
-   **Expected Result:**
    1.  An information message "MockNest server stopped" appears.
    2.  The status bar item reverts to `$(circle-slash) MockNest: OFF`.
    3.  The "Mock Routes" list in the sidebar becomes empty.
    4.  Running any of the `curl` commands from the previous step should now fail (e.g., "connection refused").
