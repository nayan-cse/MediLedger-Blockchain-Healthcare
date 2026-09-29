# MediLedger - Assignment 1

A runnable blockchain healthcare data-sharing prototype. Includes Solidity contracts, a browser dashboard, two persistent Helia/IPFS nodes, patient-controlled encryption, automated security tests, measured performance evidence, a report and a ten-minute narrated demonstration.

**Use synthetic files only.** The default program is a local laboratory with deliberately public, deterministic test-wallet keys and an unlocked local blockchain. It must not be exposed to the Internet or used for real patient data or real funds.

## Quick start (Windows, macOS or Linux)

1. Install Node.js 20 or newer; Node.js 22 LTS is recommended. The provided measurements were made with Node.js 24.19.0. Ensure at least 2 GB free RAM and 2 GB free disk space for dependencies and test data.
2. Extract this folder. Open a terminal **inside the folder containing package.json**.
3. Run `npm ci` (Internet required for the first dependency installation).
4. Run `npm start`. Leave this terminal running.
5. Open **http://localhost:3000** in Chrome or Edge.

On Windows, if PowerShell blocks npm.ps1, run the same commands in Command Prompt or use `npm.cmd ci` and `npm.cmd start`. Wait until the terminal prints `MediLedger ready`. Local ports 3000, 8545, 5001 and 5002 must be available.

The first startup compiles and deploys the contract; later startups reuse `data/chain`, `data/deployment.json`, both IPFS stores and the encrypted key-envelope index. No MetaMask or Docker is required for the supplied demo. The optional browser-wallet button supports a wallet connected to local chain 31337.

## Demonstrate all functions

1. Select **Patient** in the demo-wallet selector. Open Registration, choose Patient and register.
2. Select Doctor and register as Doctor. Select Hospital and register as Hospital.
3. Select Administrator; open Administration and approve both providers. In a real deployment professional credentials must be checked externally first.
4. Return to Patient > Medical history. Choose `samples/synthetic-medical-record.txt` and click **Encrypt & upload**. A record ID appears after the two IPFS pins and blockchain ownership transaction succeed.
5. Open the record as Patient. The plaintext is decrypted in the browser. The on-chain audit records the access request.
6. Enter the record ID under Share with a provider, choose Doctor, choose an access duration and grant access.
7. Select Doctor. Open the shared record and verify the original contents. Repeat sharing to Hospital to demonstrate organizational access.
8. Return to Patient, select the same Doctor and revoke access. Return to Doctor and use **Open a shared record by ID**. Access is denied and recorded in the audit trail.
9. Inspect Medical history, Audit trail, Administration and Performance.

Use the **same browser profile and the same hostname** each time: `localhost` and `127.0.0.1` have separate IndexedDB stores. Non-exportable RSA private keys stay in that browser profile. Clearing it loses access to existing encrypted records. This version has no key backup, recovery or rotation workflow. Changing wallets hides any currently open record but cannot remove a file already saved by its recipient.

## Run evaluation

With `npm start` running, open a second terminal:

```sh
npm test
npm run benchmark
```

Alternatively, stop the application first and use `npm run evaluate`. It starts the local services, runs both evaluation scripts, and stops afterward. Tests and benchmarks deploy separate fresh contract instances; they do not alter the UI contract's patient records. They do use the same synthetic wallets, so avoid using the dashboard while a benchmark is running. Each benchmark updates the evidence files; preserve the supplied baseline if you need it for comparison.

Outputs: `evidence/tests.tap` (from evaluate), `test-deployment.json`, `benchmark-results.json`, `transactions.csv` and `benchmark.log`. `npm test` prints its results to the terminal. The benchmark requires around a few minutes; generated timings vary by hardware and workload.

`npm run evaluate` also generates `evidence/demo-results.json` from a real scripted demonstration after the benchmark. The local chain mines on a 0.25-second timer. Concurrent load tests use one signer and explicit nonce sequence per worker. The remote HTTP layout preview cannot run native Web Crypto; actual encryption requires localhost or HTTPS. Browser layout was inspected; full browser cryptographic interactions were not verified remotely.

## Project map

| File / folder | Responsibility |
|---|---|
| contracts/HealthcareRecords.sol | Identity roles, provider approval, patient ownership, permissions, expiry and immutable event audit |
| lib/crypto.mjs | Shared Web Crypto AES-256-GCM and RSA-OAEP-SHA-256 implementation |
| lib/client.mjs | Upload, share and download workflows and signed HTTP challenges |
| lib/server.mjs | Authenticated encrypted-file gateway, consent checks, key-envelope index and audit relaying |
| lib/storage.mjs | Independent persistent Helia/IPFS node process |
| lib/resources.mjs | CPU and memory measurements, including restricted-container fallback |
| lib/fixture.mjs | Fresh local deployments for independent test and benchmark runs |
| public/ | Browser dashboard, styles and IndexedDB key storage |
| scripts/start.mjs | Starts services, deploys or reuses a contract, and shuts down |
| scripts/compile.mjs | Pinned Solidity compiler, optimizer and Shanghai EVM target |
| scripts/deploy.mjs | Optional separate external-EVM contract deployment |
| scripts/benchmark.mjs | Measured file workflows, transaction load and resource evaluation |
| tests/system.test.mjs | 22 functional and security checks |
| samples/ | Clearly fictional medical file for the demonstration |
| evidence/ | Actual local execution results and browser evidence |
| submission/ | Assignment report and demonstration materials |

## External testnet deployment

The submitted evidence is a **real local EVM deployment**, not an Ethereum public-testnet deployment. To deploy only the contract to a testnet, use your own RPC endpoint, funded test-only deployer key and a separate auditor address. Set environment variables `RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `AUDITOR_ADDRESS`, then run `npm run deploy`. Never paste a private key into source control or use the bundled demo keys on a public chain.

The optional script writes `evidence/external-deployment.json`. It does not reconfigure the demo dashboard or gateway: their chain IDs, wallet setup, signature domain and deployment configuration must be migrated together before an external-network application can operate.

## Security and limitations

- Every file has a fresh 32-byte AES key and 12-byte nonce. AES-GCM authenticates contents and a versioned AAD string. Filename and MIME metadata are encrypted too.
- RSA-OAEP encrypts the file key separately for the patient and each approved recipient. Public encryption keys are registered on-chain; private keys never leave the browser in the UI workflow.
- The contract stores CID, ciphertext SHA-256, wallet ownership, creation time and permission/envelope hashes. Wallet relationships, roles, CIDs and transaction timing are visible; the system does not claim anonymity.
- Only the patient can grant or revoke. Administrator approval only controls provider eligibility; it does not confer decryption access. Disabling a provider suspends its active grants; re-enabling it restores grants that have not expired or been revoked.
- Signed gateway requests bind address, chain, contract, method, path, body digest, nonce and expiry. Nonces expire after 60 seconds and are single use.
- The gateway waits for a read-audit transaction before releasing ciphertext and a wrapped key. It checks consent again after fetching the object. Revocation cannot recall an earlier key/plaintext copy, and a release already authorized immediately before revocation can finish.
- Successful state changes and authenticated read decisions are on-chain. Gateway API outcomes are recorded in a local hash-linked log. This local log is not independently anchored: an administrator able to replace the whole log can rewrite it. Direct IPFS ciphertext retrieval, offline decryption and rejected direct contract transactions are not globally auditable by this application.
- The gateway and wrapped-key index are still centralized availability dependencies. Both IPFS peers and the blockchain run on one host for evaluation, so this is replication and a decentralized protocol demonstration, not geographically independent fault tolerance.
- Orphaned IPFS objects can remain after an interrupted upload. If a grant succeeds but key delivery fails, the UI reports failure and the patient must share again. Upload interruption between ownership commit and owner-envelope delivery needs manual recovery from the original key envelope; no durable client upload journal is implemented.
- No clinical identity integration, emergency access, multi-staff hospital authorization, encryption-key rotation, regulatory certification or independent penetration audit is claimed. Serve with HTTPS, use protected RPCs and a managed signer/HSM, add professional identity checks, rate limits, recovery, an event indexer and external monitoring before considering a real deployment.

## Audit scope and interpretation

`ReadAudit` attests a **gateway access decision**, not proof that a human viewed a file or that delivery finished. Storage failure can follow an allowed decision; the gateway log captures the failed response. IPFS stores ciphertext publicly within this isolated local setup. Blockchain `private` visibility would not protect secrets, which is why secret data is kept off-chain.
