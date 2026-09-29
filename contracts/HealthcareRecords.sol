// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title Patient-owned consent registry (educational prototype).
/// @notice All state is public. Never put plaintext records or secret keys here.
contract HealthcareRecords {
    enum Role { None, Patient, Doctor, Hospital }
    struct Profile { Role role; bool active; string encryptionKey; }
    struct Record { address owner; string cid; bytes32 digest; uint64 createdAt; }
    struct Permission { bool active; uint64 expiresAt; bytes32 envelopeHash; }
    address public immutable administrator;
    address public immutable auditor;
    uint256 public recordCount;
    mapping(address => Profile) public profiles;
    mapping(uint256 => Record) public records;
    mapping(uint256 => mapping(address => Permission)) public permissions;

    event Registered(address indexed account, Role role);
    event ProviderStatus(address indexed account, bool active);
    event RecordCreated(uint256 indexed recordId, address indexed owner, string cid, bytes32 digest);
    event PermissionGranted(uint256 indexed recordId, address indexed owner, address indexed recipient, uint64 expiresAt, bytes32 envelopeHash);
    event PermissionRevoked(uint256 indexed recordId, address indexed owner, address indexed recipient);
    event ReadAudit(uint256 indexed recordId, address indexed actor, bool allowed, bytes32 requestHash);

    constructor(address auditAccount) {
        require(auditAccount != address(0) && auditAccount != msg.sender, "Invalid auditor");
        administrator = msg.sender;
        auditor = auditAccount;
    }
    modifier onlyOwner(uint256 id) {
        require(records[id].owner == msg.sender, "Patient owner only");
        _;
    }
    function register(Role role, string calldata encryptionKey) external {
        require(profiles[msg.sender].role == Role.None, "Already registered");
        require(role != Role.None, "Invalid role");
        require(bytes(encryptionKey).length >= 100 && bytes(encryptionKey).length <= 1024, "Invalid key size");
        profiles[msg.sender] = Profile(role, role == Role.Patient, encryptionKey);
        emit Registered(msg.sender, role);
    }
    function setProviderStatus(address account, bool active) external {
        require(msg.sender == administrator, "Administrator only");
        Role role = profiles[account].role;
        require(role == Role.Doctor || role == Role.Hospital, "Provider required");
        profiles[account].active = active;
        emit ProviderStatus(account, active);
    }
    function createRecord(string calldata cid, bytes32 digest, bytes32 ownerEnvelopeHash) external returns (uint256 id) {
        require(profiles[msg.sender].role == Role.Patient, "Patient only");
        require(bytes(cid).length >= 10 && bytes(cid).length <= 100, "Invalid CID size");
        require(digest != bytes32(0) && ownerEnvelopeHash != bytes32(0), "Empty digest");
        id = ++recordCount;
        records[id] = Record(msg.sender, cid, digest, uint64(block.timestamp));
        permissions[id][msg.sender] = Permission(true, 0, ownerEnvelopeHash);
        emit RecordCreated(id, msg.sender, cid, digest);
    }
    function grant(uint256 id, address recipient, uint64 expiresAt, bytes32 envelopeHash) external onlyOwner(id) {
        Profile storage provider = profiles[recipient];
        require(provider.active && (provider.role == Role.Doctor || provider.role == Role.Hospital), "Approved provider required");
        require(expiresAt == 0 || expiresAt > block.timestamp, "Expiry must be future");
        require(envelopeHash != bytes32(0), "Empty envelope");
        permissions[id][recipient] = Permission(true, expiresAt, envelopeHash);
        emit PermissionGranted(id, msg.sender, recipient, expiresAt, envelopeHash);
    }
    function revoke(uint256 id, address recipient) external onlyOwner(id) {
        require(recipient != msg.sender, "Cannot revoke owner");
        require(permissions[id][recipient].active, "No active grant");
        delete permissions[id][recipient];
        emit PermissionRevoked(id, msg.sender, recipient);
    }
    function canAccess(uint256 id, address actor) public view returns (bool) {
        address owner = records[id].owner;
        if (owner == address(0)) return false;
        if (actor == owner) return true;
        Permission storage p = permissions[id][actor];
        return profiles[actor].active && p.active && (p.expiresAt == 0 || p.expiresAt > block.timestamp);
    }
    /// @dev Only the authenticated gateway auditor can attest a read request.
    /// Denied requests do not revert, preserving their event in the ledger.
    function logRead(uint256 id, address actor, bytes32 requestHash) external {
        require(msg.sender == auditor, "Auditor only");
        emit ReadAudit(id, actor, canAccess(id, actor), requestHash);
    }
}
