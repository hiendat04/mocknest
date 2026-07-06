# MockNest

MockNest is a VS Code extension for running a local mock API server from an OpenAPI specification.

## Features

- Start and stop a local mock server from VS Code.
- Browse OpenAPI routes in the Activity Bar.
- Send requests from the built-in API Tester.
- Copy API Tester requests as cURL, JavaScript fetch, or `.http` snippets.
- Generate a spec quality scorecard for mockability, schema coverage, examples, and error-path readiness.
- Compare the loaded OpenAPI spec against a baseline and generate a PR-ready contract change report.
- Generate dependency-free contract smoke tests for local or CI runs.
- Generate dependency-free traffic replay tests from captured request logs.
- Generate importable edge-case scenario packs for errors, empty states, slow responses, and invalid requests.
- Record request log entries as replay scenarios and export scenario packs.
- Analyze request-log traffic for status and schema drift from the OpenAPI contract.
- Inspect request logs and generate a contract coverage report.
- Tune delay, failure rate, strict validation, proxy recording, and stateful mock behavior.

## Usage

Open a workspace that contains an `openapi`, `swagger`, or `api-spec` YAML/JSON file, then use the MockNest Activity Bar view or Command Palette to start the mock server.
