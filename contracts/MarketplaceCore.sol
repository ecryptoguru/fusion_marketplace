// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title AIAgentMarketplace
 * @dev Smart contract for a decentralized AI agent marketplace
 */
contract AIAgentMarketplace {
    // State variables
    address public owner;
    uint256 private agentIdCounter;
    uint256 public platformFeePercentage; // In basis points (1/100 of a percent)
    
    // Structs
    struct Agent {
        uint256 id;
        string name;
        string description;
        string category;
        address developer;
        uint256 price;
        string modelCID;         // Filecoin CID for the AI model
        string metadataCID;      // Filecoin CID for metadata
        string framework;        // AI framework used (e.g., TensorFlow, PyTorch)
        string resourceRequirements;
        bool isListed;
        uint256 registrationTimestamp;
        uint256 averageRating;   // Scaled by 100 (e.g., 475 = 4.75/5)
        uint256 reviewCount;
    }
    
    struct User {
        address userAddress;
        string userName;
        uint256 registrationTimestamp;
        bool isRegistered;
    }
    
    struct Purchase {
        uint256 purchaseId;
        uint256 agentId;
        address buyer;
        address seller;
        uint256 pricePaid;
        uint256 purchaseTimestamp;
        bool reviewed;
    }
    
    struct Review {
        uint256 reviewId;
        uint256 agentId;
        address reviewer;
        uint256 rating;  // 1-5, scaled by 100
        string comment;
        uint256 timestamp;
    }
    
    // Mappings
    mapping(uint256 => Agent) public agents;
    mapping(address => User) public users;
    mapping(address => uint256) public developerBalances;
    mapping(uint256 => Purchase[]) public agentPurchases;
    mapping(address => uint256[]) public userPurchaseHistory;
    mapping(uint256 => Review[]) public agentReviews;
    mapping(uint256 => uint256) public reviewIdCounter;
    
    // Arrays
    uint256[] public allAgentIds;
    
    // Events
    event UserRegistered(address indexed userAddress, string userName, uint256 timestamp);
    event AgentRegistered(uint256 indexed agentId, string name, address indexed developer, uint256 timestamp);
    event AgentListed(uint256 indexed agentId, uint256 price, uint256 timestamp);
    event AgentUnlisted(uint256 indexed agentId, uint256 timestamp);
    event AgentPurchased(uint256 indexed agentId, address indexed buyer, address indexed seller, uint256 price, uint256 timestamp);
    event ReviewSubmitted(uint256 indexed agentId, address indexed reviewer, uint256 rating, uint256 timestamp);
    event PriceUpdated(uint256 indexed agentId, uint256 oldPrice, uint256 newPrice, uint256 timestamp);
    event FundsWithdrawn(address indexed developer, uint256 amount, uint256 timestamp);
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized: caller is not the owner");
        _;
    }
    
    modifier onlyRegisteredUser() {
        require(users[msg.sender].isRegistered, "Not authorized: user not registered");
        _;
    }
    
    modifier onlyDeveloper(uint256 _agentId) {
        require(agents[_agentId].developer == msg.sender, "Not authorized: caller is not the agent developer");
        _;
    }
    
    modifier agentExists(uint256 _agentId) {
        require(_agentId > 0 && _agentId <= agentIdCounter, "Agent does not exist");
        _;
    }
    
    modifier isListed(uint256 _agentId) {
        require(agents[_agentId].isListed, "Agent is not listed for sale");
        _;
    }
    
    // Reentrancy guard
    bool private locked;
    modifier noReentrancy() {
        require(!locked, "Reentrant call detected");
        locked = true;
        _;
        locked = false;
    }
    
    /**
     * @dev Constructor to initialize the marketplace
     * @param _platformFeePercentage Platform fee percentage in basis points (e.g., 250 = 2.5%)
     */
    constructor(uint256 _platformFeePercentage) {
        require(_platformFeePercentage <= 1000, "Platform fee cannot exceed 10%");
        owner = msg.sender;
        platformFeePercentage = _platformFeePercentage;
        agentIdCounter = 0;
    }
    
    /**
     * @dev Register a new user
     * @param _userName Username for the new user
     */
    function registerUser(string memory _userName) external {
        require(!users[msg.sender].isRegistered, "User already registered");
        require(bytes(_userName).length > 0, "Username cannot be empty");
        
        users[msg.sender] = User({
            userAddress: msg.sender,
            userName: _userName,
            registrationTimestamp: block.timestamp,
            isRegistered: true
        });
        
        emit UserRegistered(msg.sender, _userName, block.timestamp);
    }
    
    /**
     * @dev Register a new AI agent
     * @param _name Name of the AI agent
     * @param _description Description of the AI agent
     * @param _category Category of the AI agent
     * @param _price Price of the AI agent (in wei)
     * @param _modelCID Filecoin CID for the AI model
     * @param _metadataCID Filecoin CID for the agent metadata
     * @param _framework AI framework used (e.g., TensorFlow, PyTorch)
     * @param _resourceRequirements Resource requirements for the AI agent
     */
    function registerAgent(
        string memory _name,
        string memory _description,
        string memory _category,
        uint256 _price,
        string memory _modelCID,
        string memory _metadataCID,
        string memory _framework,
        string memory _resourceRequirements
    ) external onlyRegisteredUser {
        require(bytes(_name).length > 0, "Name cannot be empty");
        require(bytes(_description).length > 0, "Description cannot be empty");
        require(bytes(_category).length > 0, "Category cannot be empty");
        require(bytes(_modelCID).length > 0, "Model CID cannot be empty");
        
        agentIdCounter++;
        uint256 newAgentId = agentIdCounter;
        
        agents[newAgentId] = Agent({
            id: newAgentId,
            name: _name,
            description: _description,
            category: _category,
            developer: msg.sender,
            price: _price,
            modelCID: _modelCID,
            metadataCID: _metadataCID,
            framework: _framework,
            resourceRequirements: _resourceRequirements,
            isListed: false,
            registrationTimestamp: block.timestamp,
            averageRating: 0,
            reviewCount: 0
        });
        
        allAgentIds.push(newAgentId);
        
        emit AgentRegistered(newAgentId, _name, msg.sender, block.timestamp);
    }
    
    /**
     * @dev List an AI agent for sale
     * @param _agentId ID of the agent to list
     * @param _price Price for the AI agent (in wei)
     */
    function listAgent(uint256 _agentId, uint256 _price) external agentExists(_agentId) onlyDeveloper(_agentId) {
        require(!agents[_agentId].isListed, "Agent is already listed");
        require(_price > 0, "Price must be greater than zero");
        
        agents[_agentId].isListed = true;
        agents[_agentId].price = _price;
        
        emit AgentListed(_agentId, _price, block.timestamp);
    }
    
    /**
     * @dev Unlist an AI agent from sale
     * @param _agentId ID of the agent to unlist
     */
    function unlistAgent(uint256 _agentId) external agentExists(_agentId) onlyDeveloper(_agentId) {
        require(agents[_agentId].isListed, "Agent is not listed");
        
        agents[_agentId].isListed = false;
        
        emit AgentUnlisted(_agentId, block.timestamp);
    }
    
    /**
     * @dev Purchase an AI agent
     * @param _agentId ID of the agent to purchase
     */
    function purchaseAgent(uint256 _agentId) external payable agentExists(_agentId) isListed(_agentId) onlyRegisteredUser noReentrancy {
        Agent storage agent = agents[_agentId];
        require(msg.value >= agent.price, "Insufficient funds sent");
        
        address developer = agent.developer;
        uint256 price = agent.price;
        
        // Calculate platform fee
        uint256 platformFee = (price * platformFeePercentage) / 10000;
        uint256 developerAmount = price - platformFee;
        
        // Update balances
        developerBalances[developer] += developerAmount;
        
        // Create purchase record
        Purchase memory newPurchase = Purchase({
            purchaseId: agentPurchases[_agentId].length,
            agentId: _agentId,
            buyer: msg.sender,
            seller: developer,
            pricePaid: price,
            purchaseTimestamp: block.timestamp,
            reviewed: false
        });
        
        agentPurchases[_agentId].push(newPurchase);
        userPurchaseHistory[msg.sender].push(_agentId);
        
        // Refund excess payment if any
        if (msg.value > price) {
            payable(msg.sender).transfer(msg.value - price);
        }
        
        emit AgentPurchased(_agentId, msg.sender, developer, price, block.timestamp);
    }
    
    /**
     * @dev Update the price of a listed AI agent
     * @param _agentId ID of the agent
     * @param _newPrice New price for the AI agent (in wei)
     */
    function updateAgentPrice(uint256 _agentId, uint256 _newPrice) external agentExists(_agentId) onlyDeveloper(_agentId) {
        require(_newPrice > 0, "Price must be greater than zero");
        
        uint256 oldPrice = agents[_agentId].price;
        agents[_agentId].price = _newPrice;
        
        emit PriceUpdated(_agentId, oldPrice, _newPrice, block.timestamp);
    }
    
    /**
     * @dev Submit a review for a purchased AI agent
     * @param _agentId ID of the agent to review
     * @param _rating Rating for the agent (1-5, scaled by 100, e.g., 475 = 4.75/5)
     * @param _comment Review comment
     */
    function submitReview(uint256 _agentId, uint256 _rating, string memory _comment) external agentExists(_agentId) onlyRegisteredUser {
        require(_rating >= 100 && _rating <= 500, "Rating must be between 1.00 and 5.00");
        
        // Check if user has purchased the agent
        bool hasPurchased = false;
        uint256 purchaseIndex;
        
        for (uint256 i = 0; i < agentPurchases[_agentId].length; i++) {
            if (agentPurchases[_agentId][i].buyer == msg.sender) {
                hasPurchased = true;
                purchaseIndex = i;
                break;
            }
        }
        
        require(hasPurchased, "You must purchase the agent before reviewing");
        require(!agentPurchases[_agentId][purchaseIndex].reviewed, "You have already reviewed this agent");
        
        // Mark purchase as reviewed
        agentPurchases[_agentId][purchaseIndex].reviewed = true;
        
        // Create review
        uint256 reviewId = reviewIdCounter[_agentId]++;
        
        Review memory newReview = Review({
            reviewId: reviewId,
            agentId: _agentId,
            reviewer: msg.sender,
            rating: _rating,
            comment: _comment,
            timestamp: block.timestamp
        });
        
        agentReviews[_agentId].push(newReview);
        
        // Update agent's average rating
        updateAgentRating(_agentId, _rating);
        
        emit ReviewSubmitted(_agentId, msg.sender, _rating, block.timestamp);
    }
    
    /**
     * @dev Update agent's average rating
     * @param _agentId ID of the agent
     * @param _newRating New rating to include in the average
     */
    function updateAgentRating(uint256 _agentId, uint256 _newRating) internal {
        Agent storage agent = agents[_agentId];
        
        uint256 totalRating = agent.averageRating * agent.reviewCount + _newRating;
        agent.reviewCount++;
        agent.averageRating = totalRating / agent.reviewCount;
    }
    
    /**
     * @dev Withdraw accumulated funds (for developers)
     */
    function withdrawFunds() external noReentrancy {
        uint256 amount = developerBalances[msg.sender];
        require(amount > 0, "No funds available to withdraw");
        
        developerBalances[msg.sender] = 0;
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
        
        emit FundsWithdrawn(msg.sender, amount, block.timestamp);
    }
    
    /**
     * @dev Update platform fee percentage (only owner)
     * @param _newFeePercentage New platform fee percentage in basis points
     */
    function updatePlatformFee(uint256 _newFeePercentage) external onlyOwner {
        require(_newFeePercentage <= 1000, "Platform fee cannot exceed 10%");
        platformFeePercentage = _newFeePercentage;
    }
    
    /**
     * @dev Get all agent IDs
     * @return Array of all registered agent IDs
     */
    function getAllAgentIds() external view returns (uint256[] memory) {
        return allAgentIds;
    }
    
    /**
     * @dev Get user's purchase history
     * @param _user Address of the user
     * @return Array of agent IDs purchased by the user
     */
    function getUserPurchaseHistory(address _user) external view returns (uint256[] memory) {
        return userPurchaseHistory[_user];
    }
    
    /**
     * @dev Get agent purchase records
     * @param _agentId ID of the agent
     * @return Array of Purchase structs for the agent
     */
    function getAgentPurchases(uint256 _agentId) external view agentExists(_agentId) returns (Purchase[] memory) {
        return agentPurchases[_agentId];
    }
    
    /**
     * @dev Get agent reviews
     * @param _agentId ID of the agent
     * @return Array of Review structs for the agent
     */
    function getAgentReviews(uint256 _agentId) external view agentExists(_agentId) returns (Review[] memory) {
        return agentReviews[_agentId];
    }

/**
     * @dev Check if a user has purchased a specific agent
     * @param _user Address of the user
     * @param _agentId ID of the agent
     * @return bool indicating whether the user has purchased the agent
     */
    function hasUserPurchasedAgent(address _user, uint256 _agentId) external view agentExists(_agentId) returns (bool) {
        for (uint256 i = 0; i < agentPurchases[_agentId].length; i++) {
            if (agentPurchases[_agentId][i].buyer == _user) {
                return true;
            }
        }
        return false;
    }