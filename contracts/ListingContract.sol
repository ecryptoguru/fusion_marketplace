// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

interface IAgentRegistry {
    function getAgent(uint256 agentId) external view returns (
        string memory name,
        string memory description,
        string memory category,
        string memory technicalSpecs,
        string memory documentationCID,
        address owner,
        bool isActive,
        uint256 registrationTime
    );
    
    function hasSeller(address user) external view returns (bool);
}

/**
 * @title ListingContract
 * @dev Contract for listing AI agents on the marketplace
 */
contract ListingContract is AccessControl, ReentrancyGuard {
    using Counters for Counters.Counter;
    
    bytes32 public constant SELLER_ROLE = keccak256("SELLER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    enum ListingStatus { Active, Sold, Delisted }
    
    struct Listing {
        uint256 id;
        uint256 agentId;
        address seller;
        uint256 price;
        ListingStatus status;
        uint256 listingTime;
        uint256 expirationTime; // 0 means no expiration
        string usageTermsCID; // IPFS/Filecoin CID for usage terms
        bool trialAvailable;
        uint256 trialDuration; // Trial period in seconds, 0 means no trial
    }
    
    Counters.Counter private _listingIds;
    
    // Mapping from listing ID to Listing struct
    mapping(uint256 => Listing) private _listings;
    
    // Mapping from agent ID to listing ID (if listed)
    mapping(uint256 => uint256) private _agentListings;
    
    // Mapping from seller to their listing IDs
    mapping(address => uint256[]) private _sellerListings;
    
    // Agent Registry contract reference
    IAgentRegistry private _agentRegistry;
    
    // Events
    event AgentListed(uint256 indexed listingId, uint256 indexed agentId, address indexed seller, uint256 price);
    event ListingUpdated(uint256 indexed listingId, uint256 price);
    event ListingDelisted(uint256 indexed listingId);
    event ListingSold(uint256 indexed listingId, address indexed buyer);
    
    /**
     * @dev Constructor to set up roles and agent registry
     * @param agentRegistryAddress Address of the Agent Registry contract
     */
    constructor(address agentRegistryAddress) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(SELLER_ROLE, msg.sender);
        
        _agentRegistry = IAgentRegistry(agentRegistryAddress);
    }
    
    /**
     * @dev List an AI agent for sale
     * @param agentId ID of the agent in the registry
     * @param price Price in wei
     * @param expirationTime Timestamp when the listing expires (0 for no expiration)
     * @param usageTermsCID IPFS/Filecoin CID for detailed usage terms
     * @param trialAvailable Whether a trial is available
     * @param trialDuration Duration of the trial in seconds
     */
    function listAgent(
        uint256 agentId,
        uint256 price,
        uint256 expirationTime,
        string memory usageTermsCID,
        bool trialAvailable,
        uint256 trialDuration
    ) 
        external 
        onlyRole(SELLER_ROLE) 
        nonReentrant 
        returns (uint256) 
    {
        // Get agent details to verify ownership and active status
        (,,,,,address owner, bool isActive,) = _agentRegistry.getAgent(agentId);
        
        require(msg.sender == owner, "ListingContract: not the owner of the agent");
        require(isActive, "ListingContract: agent is not active");
        require(_agentListings[agentId] == 0, "ListingContract: agent already listed");
        require(price > 0, "ListingContract: price must be greater than 0");
        
        // If expiration is set, it should be in the future
        if (expirationTime > 0) {
            require(expirationTime > block.timestamp, "ListingContract: expiration must be in the future");
        }
        
        _listingIds.increment();
        uint256 newListingId = _listingIds.current();
        
        _listings[newListingId] = Listing({
            id: newListingId,
            agentId: agentId,
            seller: msg.sender,
            price: price,
            status: ListingStatus.Active,
            listingTime: block.timestamp,
            expirationTime: expirationTime,
            usageTermsCID: usageTermsCID,
            trialAvailable: trialAvailable,
            trialDuration: trialDuration
        });
        
        _agentListings[agentId] = newListingId;
        _sellerListings[msg.sender].push(newListingId);
        
        emit AgentListed(newListingId, agentId, msg.sender, price);
        
        return newListingId;
    }
    
    /**
     * @dev Update an existing listing
     * @param listingId ID of the listing
     * @param price New price in wei
     * @param expirationTime New expiration timestamp
     * @param usageTermsCID New IPFS/Filecoin CID for usage terms
     * @param trialAvailable Whether a trial is available
     * @param trialDuration Duration of the trial in seconds
     */
    function updateListing(
        uint256 listingId,
        uint256 price,
        uint256 expirationTime,
        string memory usageTermsCID,
        bool trialAvailable,
        uint256 trialDuration
    ) 
        external 
        nonReentrant 
    {
        require(_listings[listingId].id == listingId, "ListingContract: listing does not exist");
        require(msg.sender == _listings[listingId].seller, "ListingContract: not the seller");
        require(_listings[listingId].status == ListingStatus.Active, "ListingContract: listing not active");
        require(price > 0, "ListingContract: price must be greater than 0");
        
        // If expiration is set, it should be in the future
        if (expirationTime > 0) {
            require(expirationTime > block.timestamp, "ListingContract: expiration must be in the future");
        }
        
        Listing storage listing = _listings[listingId];
        
        listing.price = price;
        listing.expirationTime = expirationTime;
        listing.usageTermsCID = usageTermsCID;
        listing.trialAvailable = trialAvailable;
        listing.trialDuration = trialDuration;
        
        emit ListingUpdated(listingId, price);
    }
    
    /**
     * @dev Delist an agent (remove from sale)
     * @param listingId ID of the listing
     */
    function delistAgent(uint256 listingId) external nonReentrant {
        require(_listings[listingId].id == listingId, "ListingContract: listing does not exist");
        require(
            msg.sender == _listings[listingId].seller || hasRole(ADMIN_ROLE, msg.sender),
            "ListingContract: not authorized"
        );
        require(_listings[listingId].status == ListingStatus.Active, "ListingContract: listing not active");
        
        _listings[listingId].status = ListingStatus.Delisted;
        _agentListings[_listings[listingId].agentId] = 0; // Clear the listing reference
        
        emit ListingDelisted(listingId);
    }
    
    /**
     * @dev Mark a listing as sold (called by marketplace contract)
     * @param listingId ID of the listing
     * @param buyer Address of the buyer
     */
    function markAsSold(uint256 listingId, address buyer) 
        external 
        onlyRole(ADMIN_ROLE) 
        nonReentrant 
        returns (bool) 
    {
        require(_listings[listingId].id == listingId, "ListingContract: listing does not exist");
        require(_listings[listingId].status == ListingStatus.Active, "ListingContract: listing not active");
        require(buyer != address(0), "ListingContract: buyer is the zero address");
        
        _listings[listingId].status = ListingStatus.Sold;
        _agentListings[_listings[listingId].agentId] = 0; // Clear the listing reference
        
        emit ListingSold(listingId, buyer);
        
        return true;
    }
    
    /**
     * @dev Get listing details by ID
     * @param listingId ID of the listing
     */
    function getListing(uint256 listingId) 
        external 
        view 
        returns (
            uint256 id,
            uint256 agentId,
            address seller,
            uint256 price,
            ListingStatus status,
            uint256 listingTime,
            uint256 expirationTime,
            string memory usageTermsCID,
            bool trialAvailable,
            uint256 trialDuration
        ) 
    {
        require(_listings[listingId].id == listingId, "ListingContract: listing does not exist");
        
        Listing storage listing = _listings[listingId];
        
        return (
            listing.id,
            listing.agentId,
            listing.seller,
            listing.price,
            listing.status,
            listing.listingTime,
            listing.expirationTime,
            listing.usageTermsCID,
            listing.trialAvailable,
            listing.trialDuration
        );
    }
    
    /**
     * @dev Get listing ID for a specific agent
     * @param agentId ID of the agent
     */
    function getListingByAgentId(uint256 agentId) external view returns (uint256) {
        uint256 listingId = _agentListings[agentId];
        if (listingId > 0) {
            if (_listings[listingId].status == ListingStatus.Active) {
                // Check if listing has expired
                if (_listings[listingId].expirationTime > 0 && 
                    _listings[listingId].expirationTime <= block.timestamp) {
                    return 0; // Listing has expired
                }
                return listingId;
            }
        }
        return 0; // Not listed or not active
    }
    
    /**
     * @dev Get all listing IDs by a seller
     * @param seller Address of the seller
     */
    function getListingsBySeller(address seller) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return _sellerListings[seller];
    }
    
    /**
     * @dev Get the total number of listings
     */
    function getTotalListings() external view returns (uint256) {
        return _listingIds.current();
    }
    
    /**
     * @dev Check if a listing exists and is active
     * @param listingId ID of the listing
     */
    function isListingActive(uint256 listingId) external view returns (bool) {
        if (_listings[listingId].id != listingId) {
            return false;
        }
        
        if (_listings[listingId].status != ListingStatus.Active) {
            return false;
        }
        
        // Check if the listing has expired
        if (_listings[listingId].expirationTime > 0 && 
            _listings[listingId].expirationTime <= block.timestamp) {
            return false;
        }
        
        return true;
    }
    
    /**
     * @dev Get the price of a listing
     * @param listingId ID of the listing
     */
    function getListingPrice(uint256 listingId) external view returns (uint256) {
        require(_listings[listingId].id == listingId, "ListingContract: listing does not exist");
        require(_listings[listingId].status == ListingStatus.Active, "ListingContract: listing not active");
        
        // Check if the listing has expired
        if (_listings[listingId].expirationTime > 0 && 
            _listings[listingId].expirationTime <= block.timestamp) {
            revert("ListingContract: listing has expired");
        }
        
        return _listings[listingId].price;
    }
}
