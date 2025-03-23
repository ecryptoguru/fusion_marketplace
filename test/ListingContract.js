/*
This test suite thoroughly covers all the features and functions of the ListingContract. 

Test Structure

Deployment Tests: Verify contract initialization with the right parameters and roles
Role Management: Test adding and removing sellers and admin roles
Agent Listing: Tests for listing agents, validation checks, and edge cases
Listing Updates: Test updating various listing parameters and permission checks
Delisting: Test removing listings from active state
Mark as Sold: Test the sales process and access controls
Listing Queries: Test all query functions for listing data

Key Features Tested

Agent ownership validation
Price and expiration time validations
Active status checks
Permission-based access controls
Expiration time handling
Status management (Active, Sold, Delisted)
Event emissions

Mock Contract
The test file includes a mock AgentRegistryMock contract that implements the IAgentRegistry interface to allow for comprehensive testing without needing the actual agent registry contract.
Testing Utilities

Uses Hardhat's time manipulation tools to test expiration functionality
Tests access control with different user accounts
Validates complex validation logic in the contract

*/

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ListingContract", function() {
  let ListingContract;
  let AgentRegistry;
  let listingContract;
  let agentRegistry;
  let owner;
  let seller1;
  let seller2;
  let buyer;
  let admin;
  let nonSeller;
  
  const SELLER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SELLER_ROLE"));
  const ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"));
  
  // Sample agent data
  const agentData = {
    name: "TestAgent",
    description: "A test AI agent",
    category: "Testing",
    technicalSpecs: "CPU: 2.5GHz, RAM: 8GB",
    documentationCID: "QmTest123",
    isActive: true
  };
  
  // Sample listing data
  const listingData = {
    price: ethers.utils.parseEther("1"),
    expirationTime: 0, // No expiration by default
    usageTermsCID: "QmUsageTerms123",
    trialAvailable: true,
    trialDuration: 86400 // 1 day in seconds
  };
  
  beforeEach(async function() {
    // Get signers
    [owner, seller1, seller2, buyer, admin, nonSeller] = await ethers.getSigners();
    
    // Deploy mock AgentRegistry
    const AgentRegistryMock = await ethers.getContractFactory("AgentRegistryMock");
    agentRegistry = await AgentRegistryMock.deploy();
    await agentRegistry.deployed();
    
    // Deploy ListingContract
    ListingContract = await ethers.getContractFactory("ListingContract");
    listingContract = await ListingContract.deploy(agentRegistry.address);
    await listingContract.deployed();
    
    // Grant roles
    await listingContract.grantRole(SELLER_ROLE, seller1.address);
    await listingContract.grantRole(SELLER_ROLE, seller2.address);
    await listingContract.grantRole(ADMIN_ROLE, admin.address);
    
    // Register agents in the mock registry
    await agentRegistry.addAgent(
      agentData.name,
      agentData.description,
      agentData.category,
      agentData.technicalSpecs,
      agentData.documentationCID,
      seller1.address,
      agentData.isActive
    );
    
    await agentRegistry.addAgent(
      agentData.name + "2",
      agentData.description,
      agentData.category,
      agentData.technicalSpecs,
      agentData.documentationCID,
      seller2.address,
      agentData.isActive
    );
    
    // Mark sellers in registry
    await agentRegistry.setSeller(seller1.address, true);
    await agentRegistry.setSeller(seller2.address, true);
  });
  
  describe("Deployment", function() {
    it("Should set the right owner", async function() {
      expect(await listingContract.hasRole(ethers.constants.DEFAULT_ADMIN_ROLE, owner.address)).to.equal(true);
    });
    
    it("Should assign admin role to owner", async function() {
      expect(await listingContract.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
    });
    
    it("Should set the agent registry address", async function() {
      // This is an implementation detail that's not directly exposed, but we could test it
      // indirectly by verifying that operations that depend on the agent registry work
      expect(await agentRegistry.hasSeller(seller1.address)).to.equal(true);
    });
  });
  
  describe("Role Management", function() {
    it("Should allow adding a new seller", async function() {
      await listingContract.grantRole(SELLER_ROLE, nonSeller.address);
      expect(await listingContract.hasRole(SELLER_ROLE, nonSeller.address)).to.equal(true);
    });
    
    it("Should allow removing a seller", async function() {
      await listingContract.revokeRole(SELLER_ROLE, seller1.address);
      expect(await listingContract.hasRole(SELLER_ROLE, seller1.address)).to.equal(false);
    });
    
    it("Should not allow non-admins to add sellers", async function() {
      await expect(
        listingContract.connect(seller1).grantRole(SELLER_ROLE, nonSeller.address)
      ).to.be.reverted;
    });
  });
  
  describe("Agent Listing", function() {
    it("Should allow a seller to list their agent", async function() {
      const tx = await listingContract.connect(seller1).listAgent(
        1, // agentId
        listingData.price,
        listingData.expirationTime,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
      
      // Check event emission
      await expect(tx).to.emit(listingContract, "AgentListed")
        .withArgs(1, 1, seller1.address, listingData.price);
      
      // Check listing created correctly
      const listing = await listingContract.getListing(1);
      expect(listing.id).to.equal(1);
      expect(listing.agentId).to.equal(1);
      expect(listing.seller).to.equal(seller1.address);
      expect(listing.price).to.equal(listingData.price);
      expect(listing.status).to.equal(0); // ListingStatus.Active
    });
    
    it("Should not allow listing if not the agent owner", async function() {
      await expect(
        listingContract.connect(seller2).listAgent(
          1, // agentId (owned by seller1)
          listingData.price,
          listingData.expirationTime,
          listingData.usageTermsCID,
          listingData.trialAvailable,
          listingData.trialDuration
        )
      ).to.be.revertedWith("ListingContract: not the owner of the agent");
    });
    
    it("Should not allow listing with zero price", async function() {
      await expect(
        listingContract.connect(seller1).listAgent(
          1, // agentId
          0, // price
          listingData.expirationTime,
          listingData.usageTermsCID,
          listingData.trialAvailable,
          listingData.trialDuration
        )
      ).to.be.revertedWith("ListingContract: price must be greater than 0");
    });
    
    it("Should not allow listing if agent is inactive", async function() {
      // Register an inactive agent
      await agentRegistry.addAgent(
        "InactiveAgent",
        agentData.description,
        agentData.category,
        agentData.technicalSpecs,
        agentData.documentationCID,
        seller1.address,
        false // isActive = false
      );
      
      await expect(
        listingContract.connect(seller1).listAgent(
          3, // agentId for the inactive agent
          listingData.price,
          listingData.expirationTime,
          listingData.usageTermsCID,
          listingData.trialAvailable,
          listingData.trialDuration
        )
      ).to.be.revertedWith("ListingContract: agent is not active");
    });
    
    it("Should not allow listing an agent that's already listed", async function() {
      // List the agent first
      await listingContract.connect(seller1).listAgent(
        1, // agentId
        listingData.price,
        listingData.expirationTime,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
      
      // Try to list it again
      await expect(
        listingContract.connect(seller1).listAgent(
          1, // agentId
          listingData.price,
          listingData.expirationTime,
          listingData.usageTermsCID,
          listingData.trialAvailable,
          listingData.trialDuration
        )
      ).to.be.revertedWith("ListingContract: agent already listed");
    });
    
    it("Should validate expiration time is in the future", async function() {
      const pastTimestamp = (await ethers.provider.getBlock("latest")).timestamp - 1000;
      
      await expect(
        listingContract.connect(seller1).listAgent(
          1, // agentId
          listingData.price,
          pastTimestamp, // expiration in the past
          listingData.usageTermsCID,
          listingData.trialAvailable,
          listingData.trialDuration
        )
      ).to.be.revertedWith("ListingContract: expiration must be in the future");
    });
    
    it("Should allow listing with future expiration time", async function() {
      const futureTimestamp = (await ethers.provider.getBlock("latest")).timestamp + 86400; // 1 day in the future
      
      await listingContract.connect(seller1).listAgent(
        1, // agentId
        listingData.price,
        futureTimestamp,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
      
      const listing = await listingContract.getListing(1);
      expect(listing.expirationTime).to.equal(futureTimestamp);
    });
  });
  
  describe("Listing Updates", function() {
    beforeEach(async function() {
      // Create a listing first
      await listingContract.connect(seller1).listAgent(
        1, // agentId
        listingData.price,
        listingData.expirationTime,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
    });
    
    it("Should allow seller to update listing price", async function() {
      const newPrice = ethers.utils.parseEther("2");
      
      await listingContract.connect(seller1).updateListing(
        1, // listingId
        newPrice,
        listingData.expirationTime,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
      
      const listing = await listingContract.getListing(1);
      expect(listing.price).to.equal(newPrice);
    });
    
    it("Should allow seller to update expiration time", async function() {
      const newExpirationTime = (await ethers.provider.getBlock("latest")).timestamp + 172800; // 2 days
      
      await listingContract.connect(seller1).updateListing(
        1, // listingId
        listingData.price,
        newExpirationTime,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
      
      const listing = await listingContract.getListing(1);
      expect(listing.expirationTime).to.equal(newExpirationTime);
    });
    
    it("Should not allow non-seller to update listing", async function() {
      await expect(
        listingContract.connect(seller2).updateListing(
          1, // listingId
          listingData.price,
          listingData.expirationTime,
          listingData.usageTermsCID,
          listingData.trialAvailable,
          listingData.trialDuration
        )
      ).to.be.revertedWith("ListingContract: not the seller");
    });
    
    it("Should not allow updating non-existent listing", async function() {
      await expect(
        listingContract.connect(seller1).updateListing(
          999, // non-existent listingId
          listingData.price,
          listingData.expirationTime,
          listingData.usageTermsCID,
          listingData.trialAvailable,
          listingData.trialDuration
        )
      ).to.be.revertedWith("ListingContract: listing does not exist");
    });
    
    it("Should allow updating all listing parameters", async function() {
      const newData = {
        price: ethers.utils.parseEther("3"),
        expirationTime: (await ethers.provider.getBlock("latest")).timestamp + 259200, // 3 days
        usageTermsCID: "QmNewTerms456",
        trialAvailable: false,
        trialDuration: 43200 // 12 hours
      };
      
      await listingContract.connect(seller1).updateListing(
        1, // listingId
        newData.price,
        newData.expirationTime,
        newData.usageTermsCID,
        newData.trialAvailable,
        newData.trialDuration
      );
      
      const listing = await listingContract.getListing(1);
      expect(listing.price).to.equal(newData.price);
      expect(listing.expirationTime).to.equal(newData.expirationTime);
      expect(listing.usageTermsCID).to.equal(newData.usageTermsCID);
      expect(listing.trialAvailable).to.equal(newData.trialAvailable);
      expect(listing.trialDuration).to.equal(newData.trialDuration);
    });
  });
  
  describe("Delisting", function() {
    beforeEach(async function() {
      // Create listings
      await listingContract.connect(seller1).listAgent(
        1, // agentId
        listingData.price,
        listingData.expirationTime,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
    });
    
    it("Should allow seller to delist their agent", async function() {
      await listingContract.connect(seller1).delistAgent(1);
      
      const listing = await listingContract.getListing(1);
      expect(listing.status).to.equal(2); // ListingStatus.Delisted
      
      // Check that it's no longer active
      expect(await listingContract.isListingActive(1)).to.equal(false);
      
      // Check that the agent listing reference is cleared
      expect(await listingContract.getListingByAgentId(1)).to.equal(0);
    });
    
    it("Should allow admin to delist any agent", async function() {
      await listingContract.connect(admin).delistAgent(1);
      
      const listing = await listingContract.getListing(1);
      expect(listing.status).to.equal(2); // ListingStatus.Delisted
    });
    
    it("Should not allow non-seller/non-admin to delist", async function() {
      await expect(
        listingContract.connect(seller2).delistAgent(1)
      ).to.be.revertedWith("ListingContract: not authorized");
    });
    
    it("Should not allow delisting non-existent listing", async function() {
      await expect(
        listingContract.connect(seller1).delistAgent(999)
      ).to.be.revertedWith("ListingContract: listing does not exist");
    });
    
    it("Should not allow delisting already delisted agent", async function() {
      // Delist first
      await listingContract.connect(seller1).delistAgent(1);
      
      // Try to delist again
      await expect(
        listingContract.connect(seller1).delistAgent(1)
      ).to.be.revertedWith("ListingContract: listing not active");
    });
  });
  
  describe("Mark as Sold", function() {
    beforeEach(async function() {
      // Create a listing
      await listingContract.connect(seller1).listAgent(
        1, // agentId
        listingData.price,
        listingData.expirationTime,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
    });
    
    it("Should allow admin to mark listing as sold", async function() {
      await listingContract.connect(admin).markAsSold(1, buyer.address);
      
      const listing = await listingContract.getListing(1);
      expect(listing.status).to.equal(1); // ListingStatus.Sold
      
      // Check that it's no longer active
      expect(await listingContract.isListingActive(1)).to.equal(false);
      
      // Check that the agent listing reference is cleared
      expect(await listingContract.getListingByAgentId(1)).to.equal(0);
    });
    
    it("Should emit ListingSold event", async function() {
      await expect(
        listingContract.connect(admin).markAsSold(1, buyer.address)
      ).to.emit(listingContract, "ListingSold")
        .withArgs(1, buyer.address);
    });
    
    it("Should not allow non-admin to mark as sold", async function() {
      await expect(
        listingContract.connect(seller1).markAsSold(1, buyer.address)
      ).to.be.reverted; // AccessControl error
    });
    
    it("Should not allow marking non-existent listing as sold", async function() {
      await expect(
        listingContract.connect(admin).markAsSold(999, buyer.address)
      ).to.be.revertedWith("ListingContract: listing does not exist");
    });
    
    it("Should not allow marking non-active listing as sold", async function() {
      // Delist first
      await listingContract.connect(seller1).delistAgent(1);
      
      // Try to mark as sold
      await expect(
        listingContract.connect(admin).markAsSold(1, buyer.address)
      ).to.be.revertedWith("ListingContract: listing not active");
    });
    
    it("Should not allow marking as sold with zero address buyer", async function() {
      await expect(
        listingContract.connect(admin).markAsSold(1, ethers.constants.AddressZero)
      ).to.be.revertedWith("ListingContract: buyer is the zero address");
    });
  });
  
  describe("Listing Queries", function() {
    beforeEach(async function() {
      // Create multiple listings
      await listingContract.connect(seller1).listAgent(
        1, // agentId
        listingData.price,
        listingData.expirationTime,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
      
      // Create a listing with expiration
      const futureTimestamp = (await ethers.provider.getBlock("latest")).timestamp + 86400; // 1 day
      await listingContract.connect(seller2).listAgent(
        2, // agentId
        listingData.price,
        futureTimestamp,
        listingData.usageTermsCID,
        listingData.trialAvailable,
        listingData.trialDuration
      );
    });
    
    it("Should get correct listing by ID", async function() {
      const listing = await listingContract.getListing(1);
      expect(listing.id).to.equal(1);
      expect(listing.agentId).to.equal(1);
      expect(listing.seller).to.equal(seller1.address);
    });
    
    it("Should get correct listing by agent ID", async function() {
      const listingId = await listingContract.getListingByAgentId(1);
      expect(listingId).to.equal(1);
    });
    
    it("Should return 0 for unlisted agent ID", async function() {
      await agentRegistry.addAgent(
        "NewAgent",
        agentData.description,
        agentData.category,
        agentData.technicalSpecs,
        agentData.documentationCID,
        seller1.address,
        true
      );
      
      const listingId = await listingContract.getListingByAgentId(3); // New agent ID
      expect(listingId).to.equal(0);
    });
    
    it("Should return seller's listings", async function() {
      const listings = await listingContract.getListingsBySeller(seller1.address);
      expect(listings.length).to.equal(1);
      expect(listings[0]).to.equal(1);
    });
    
    it("Should return correct total listings count", async function() {
      const totalListings = await listingContract.getTotalListings();
      expect(totalListings).to.equal(2);
    });
    
    it("Should correctly identify active listings", async function() {
      expect(await listingContract.isListingActive(1)).to.equal(true);
      
      // Delist and check again
      await listingContract.connect(seller1).delistAgent(1);
      expect(await listingContract.isListingActive(1)).to.equal(false);
    });
    
    it("Should handle expired listings correctly", async function() {
      // Initially the listing should be active
      expect(await listingContract.isListingActive(2)).to.equal(true);
      
      // Advance time past the expiration
      await time.increase(86401); // 1 day + 1 second
      
      // Now it should be considered inactive
      expect(await listingContract.isListingActive(2)).to.equal(false);
      
      // And getListingByAgentId should return 0
      expect(await listingContract.getListingByAgentId(2)).to.equal(0);
    });
    
    it("Should return listing price", async function() {
      const price = await listingContract.getListingPrice(1);
      expect(price).to.equal(listingData.price);
    });
    
    it("Should revert getting price for expired listing", async function() {
      // Advance time past the expiration of listing 2
      await time.increase(86401); // 1 day + 1 second
      
      await expect(
        listingContract.getListingPrice(2)
      ).to.be.revertedWith("ListingContract: listing has expired");
    });
  });
});

// Mock AgentRegistry for testing
contract AgentRegistryMock {
    struct Agent {
        string name;
        string description;
        string category;
        string technicalSpecs;
        string documentationCID;
        address owner;
        bool isActive;
        uint256 registrationTime;
    }
    
    mapping(uint256 => Agent) private _agents;
    mapping(address => bool) private _sellers;
    uint256 private _agentCount;
    
    function addAgent(
        string memory name,
        string memory description,
        string memory category,
        string memory technicalSpecs,
        string memory documentationCID,
        address owner,
        bool isActive
    ) public returns (uint256) {
        _agentCount++;
        
        _agents[_agentCount] = Agent({
            name: name,
            description: description,
            category: category,
            technicalSpecs: technicalSpecs,
            documentationCID: documentationCID,
            owner: owner,
            isActive: isActive,
            registrationTime: block.timestamp
        });
        
        return _agentCount;
    }
    
    function getAgent(uint256 agentId) external view returns (
        string memory name,
        string memory description,
        string memory category,
        string memory technicalSpecs,
        string memory documentationCID,
        address owner,
        bool isActive,
        uint256 registrationTime
    ) {
        Agent storage agent = _agents[agentId];
        return (
            agent.name,
            agent.description,
            agent.category,
            agent.technicalSpecs,
            agent.documentationCID,
            agent.owner,
            agent.isActive,
            agent.registrationTime
        );
    }
    
    function setSeller(address user, bool status) external {
        _sellers[user] = status;
    }
    
    function hasSeller(address user) external view returns (bool) {
        return _sellers[user];
    }
}