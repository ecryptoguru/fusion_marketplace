// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title AgentRegistry
 * @dev Contract for registering AI agents in the marketplace
 */
contract AgentRegistry is AccessControl, ReentrancyGuard {
    using Counters for Counters.Counter;
    
    bytes32 public constant SELLER_ROLE = keccak256("SELLER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    Counters.Counter private _agentIds;
    
    struct Agent {
        uint256 id;
        string name;
        string description;
        string category;
        string technicalSpecs;
        string documentationCID; // IPFS/Filecoin CID for off-chain data
        address owner;
        bool isActive;
        uint256 registrationTime;
    }
    
    // Mapping from agent ID to Agent struct
    mapping(uint256 => Agent) private _agents;
    
    // Mapping from owner address to their agent IDs
    mapping(address => uint256[]) private _ownerAgents;
    
    // Events
    event AgentRegistered(uint256 indexed agentId, address indexed owner, string name);
    event AgentUpdated(uint256 indexed agentId, address indexed owner);
    event AgentDeactivated(uint256 indexed agentId);
    event AgentReactivated(uint256 indexed agentId);
    event OwnershipTransferred(uint256 indexed agentId, address indexed previousOwner, address indexed newOwner);
    
    /**
     * @dev Constructor to set up roles
     */
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(SELLER_ROLE, msg.sender);
    }
    
    /**
     * @dev Register a new AI agent
     * @param name Name of the agent
     * @param description Detailed description of the agent
     * @param category Category or domain of the agent
     * @param technicalSpecs Technical specifications of the agent
     * @param documentationCID IPFS/Filecoin CID for off-chain documentation
     */
    function registerAgent(
        string memory name,
        string memory description,
        string memory category,
        string memory technicalSpecs,
        string memory documentationCID
    ) 
        external 
        onlyRole(SELLER_ROLE) 
        nonReentrant 
        returns (uint256) 
    {
        require(bytes(name).length > 0, "AgentRegistry: name cannot be empty");
        
        _agentIds.increment();
        uint256 newAgentId = _agentIds.current();
        
        _agents[newAgentId] = Agent({
            id: newAgentId,
            name: name,
            description: description,
            category: category,
            technicalSpecs: technicalSpecs,
            documentationCID: documentationCID,
            owner: msg.sender,
            isActive: true,
            registrationTime: block.timestamp
        });
        
        _ownerAgents[msg.sender].push(newAgentId);
        
        emit AgentRegistered(newAgentId, msg.sender, name);
        
        return newAgentId;
    }
    
    /**
     * @dev Update an existing AI agent's details
     * @param agentId ID of the agent to update
     * @param name Updated name
     * @param description Updated description
     * @param category Updated category
     * @param technicalSpecs Updated technical specifications
     * @param documentationCID Updated IPFS/Filecoin CID
     */
    function updateAgent(
        uint256 agentId,
        string memory name,
        string memory description,
        string memory category,
        string memory technicalSpecs,
        string memory documentationCID
    ) 
        external 
        nonReentrant 
    {
        require(_exists(agentId), "AgentRegistry: agent does not exist");
        require(msg.sender == _agents[agentId].owner, "AgentRegistry: not the owner");
        require(_agents[agentId].isActive, "AgentRegistry: agent is not active");
        require(bytes(name).length > 0, "AgentRegistry: name cannot be empty");
        
        Agent storage agent = _agents[agentId];
        
        agent.name = name;
        agent.description = description;
        agent.category = category;
        agent.technicalSpecs = technicalSpecs;
        agent.documentationCID = documentationCID;
        
        emit AgentUpdated(agentId, msg.sender);
    }
    
    /**
     * @dev Deactivate an agent
     * @param agentId ID of the agent to deactivate
     */
    function deactivateAgent(uint256 agentId) external nonReentrant {
        require(_exists(agentId), "AgentRegistry: agent does not exist");
        require(
            msg.sender == _agents[agentId].owner || hasRole(ADMIN_ROLE, msg.sender),
            "AgentRegistry: not authorized"
        );
        require(_agents[agentId].isActive, "AgentRegistry: agent is already inactive");
        
        _agents[agentId].isActive = false;
        
        emit AgentDeactivated(agentId);
    }

