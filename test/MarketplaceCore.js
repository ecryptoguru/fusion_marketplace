
/*
This JavaScript test file is designed to comprehensively test the AIAgentMarketplace smart contract. 
Here's a breakdown of what the tests cover:

Deployment Tests:
Verify the contract deploys correctly with the right owner
Check that the platform fee percentage is set correctly

User Registration Tests:
Register new users
Validate username requirements
Prevent duplicate registrations

Agent Registration Tests:
Register new AI agents
Ensure only registered users can create agents
Validate required fields like model CID

Listing and Purchasing Tests:
List agents for sale
Purchase agents
Validate permissions (only developers can list their agents)
Ensure correct funds are required for purchases
Verify platform fees are calculated and distributed correctly

Reviews and Ratings Tests:
Submit reviews for purchased agents
Calculate average ratings
Prevent unauthorized reviews

Developer Withdrawals Tests:
Allow developers to withdraw their earnings
Prevent withdrawals with zero balance

Platform Management Tests:
Update platform fees
Transfer ownership
Pause/unpause contract functionality

Statistics and Categorization Tests:
Get marketplace statistics
Filter agents by category
Get developer's agents
Check if users have purchased specific agents

Metadata Updates Tests:
Update agent metadata
Update agent model CID

The tests use Hardhat and Chai for testing, which are standard tools in the Ethereum development ecosystem. 
To run these tests, you would need to set up a Hardhat or Truffle project with the AIAgentMarketplace contract.
*/

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AIAgentMarketplace", function () {
  let marketplaceContract;
  let owner;
  let developer;
  let buyer;
  let addrs;
  const platformFeePercentage = 250; // 2.5%

  // Setup before each test
  beforeEach(async function () {
    // Get signers
    [owner, developer, buyer, ...addrs] = await ethers.getSigners();

    // Deploy the contract
    const AIAgentMarketplace = await ethers.getContractFactory("AIAgentMarketplace");
    marketplaceContract = await AIAgentMarketplace.deploy(platformFeePercentage);
    await marketplaceContract.deployed();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await marketplaceContract.owner()).to.equal(owner.address);
    });

    it("Should set the correct platform fee percentage", async function () {
      expect(await marketplaceContract.platformFeePercentage()).to.equal(platformFeePercentage);
    });
  });

  describe("User Registration", function () {
    it("Should register a new user", async function () {
      const userName = "TestUser";
      await marketplaceContract.connect(developer).registerUser(userName);
      
      const user = await marketplaceContract.users(developer.address);
      expect(user.userName).to.equal(userName);
      expect(user.isRegistered).to.equal(true);
    });

    it("Should not allow empty username", async function () {
      await expect(marketplaceContract.connect(developer).registerUser(""))
        .to.be.revertedWith("Username cannot be empty");
    });

    it("Should not allow duplicate registration", async function () {
      await marketplaceContract.connect(developer).registerUser("TestUser");
      await expect(marketplaceContract.connect(developer).registerUser("AnotherName"))
        .to.be.revertedWith("User already registered");
    });
  });

  describe("Agent Registration", function () {
    beforeEach(async function () {
      // Register users
      await marketplaceContract.connect(developer).registerUser("Developer");
      await marketplaceContract.connect(buyer).registerUser("Buyer");
    });

    it("Should register a new agent", async function () {
      await marketplaceContract.connect(developer).registerAgent(
        "Test Agent",
        "A test AI agent",
        "Chatbot",
        ethers.utils.parseEther("1"),
        "QmModelCID",
        "QmMetadataCID",
        "TensorFlow",
        "4GB RAM, 2 CPU cores"
      );

      const agent = await marketplaceContract.agents(1);
      expect(agent.name).to.equal("Test Agent");
      expect(agent.developer).to.equal(developer.address);
      expect(agent.isListed).to.equal(false);
    });

    it("Should not allow unregistered users to register agents", async function () {
      await expect(marketplaceContract.connect(addrs[0]).registerAgent(
        "Test Agent",
        "A test AI agent",
        "Chatbot",
        ethers.utils.parseEther("1"),
        "QmModelCID",
        "QmMetadataCID",
        "TensorFlow",
        "4GB RAM, 2 CPU cores"
      )).to.be.revertedWith("Not authorized: user not registered");
    });

    it("Should not allow empty model CID", async function () {
      await expect(marketplaceContract.connect(developer).registerAgent(
        "Test Agent",
        "A test AI agent",
        "Chatbot",
        ethers.utils.parseEther("1"),
        "",
        "QmMetadataCID",
        "TensorFlow",
        "4GB RAM, 2 CPU cores"
      )).to.be.revertedWith("Model CID cannot be empty");
    });
  });

  describe("Agent Listing and Purchasing", function () {
    const agentPrice = ethers.utils.parseEther("1");
    let agentId;

    beforeEach(async function () {
      // Register users
      await marketplaceContract.connect(developer).registerUser("Developer");
      await marketplaceContract.connect(buyer).registerUser("Buyer");

      // Register agent
      await marketplaceContract.connect(developer).registerAgent(
        "Test Agent",
        "A test AI agent",
        "Chatbot",
        agentPrice,
        "QmModelCID",
        "QmMetadataCID",
        "TensorFlow",
        "4GB RAM, 2 CPU cores"
      );
      agentId = 1;
    });

    it("Should list an agent for sale", async function () {
      await marketplaceContract.connect(developer).listAgent(agentId, agentPrice);
      
      const agent = await marketplaceContract.agents(agentId);
      expect(agent.isListed).to.equal(true);
      expect(agent.price).to.equal(agentPrice);
    });

    it("Should not allow non-developer to list agent", async function () {
      await expect(marketplaceContract.connect(buyer).listAgent(agentId, agentPrice))
        .to.be.revertedWith("Not authorized: caller is not the agent developer");
    });

    it("Should allow purchasing a listed agent", async function () {
      // List the agent
      await marketplaceContract.connect(developer).listAgent(agentId, agentPrice);
      
      // Purchase the agent
      await marketplaceContract.connect(buyer).purchaseAgent(agentId, { value: agentPrice });
      
      // Check that the purchase was recorded
      const purchases = await marketplaceContract.getAgentPurchases(agentId);
      expect(purchases.length).to.equal(1);
      expect(purchases[0].buyer).to.equal(buyer.address);
      expect(purchases[0].seller).to.equal(developer.address);
      expect(purchases[0].pricePaid).to.equal(agentPrice);
    });

    it("Should not allow purchasing an unlisted agent", async function () {
      await expect(marketplaceContract.connect(buyer).purchaseAgent(agentId, { value: agentPrice }))
        .to.be.revertedWith("Agent is not listed for sale");
    });

    it("Should not allow purchasing with insufficient funds", async function () {
      // List the agent
      await marketplaceContract.connect(developer).listAgent(agentId, agentPrice);
      
      // Try to purchase with insufficient funds
      await expect(marketplaceContract.connect(buyer).purchaseAgent(agentId, { value: ethers.utils.parseEther("0.5") }))
        .to.be.revertedWith("Insufficient funds sent");
    });

    it("Should calculate and distribute platform fees correctly", async function () {
      // List the agent
      await marketplaceContract.connect(developer).listAgent(agentId, agentPrice);
      
      // Purchase the agent
      await marketplaceContract.connect(buyer).purchaseAgent(agentId, { value: agentPrice });
      
      // Calculate expected fee
      const platformFee = agentPrice.mul(platformFeePercentage).div(10000);
      const developerAmount = agentPrice.sub(platformFee);
      
      // Check developer balance
      const developerBalance = await marketplaceContract.developerBalances(developer.address);
      expect(developerBalance).to.equal(developerAmount);
    });
  });

  describe("Reviews and Ratings", function () {
    let agentId;
    const agentPrice = ethers.utils.parseEther("1");

    beforeEach(async function () {
      // Register users
      await marketplaceContract.connect(developer).registerUser("Developer");
      await marketplaceContract.connect(buyer).registerUser("Buyer");

      // Register and list agent
      await marketplaceContract.connect(developer).registerAgent(
        "Test Agent",
        "A test AI agent",
        "Chatbot",
        agentPrice,
        "QmModelCID",
        "QmMetadataCID",
        "TensorFlow",
        "4GB RAM, 2 CPU cores"
      );
      agentId = 1;
      await marketplaceContract.connect(developer).listAgent(agentId, agentPrice);
      
      // Purchase agent
      await marketplaceContract.connect(buyer).purchaseAgent(agentId, { value: agentPrice });
    });

    it("Should allow buyer to submit a review", async function () {
      const rating = 450; // 4.5 stars
      const comment = "Great agent!";
      
      await marketplaceContract.connect(buyer).submitReview(agentId, rating, comment);
      
      const reviews = await marketplaceContract.getAgentReviews(agentId);
      expect(reviews.length).to.equal(1);
      expect(reviews[0].rating).to.equal(rating);
      expect(reviews[0].comment).to.equal(comment);
      
      const agent = await marketplaceContract.agents(agentId);
      expect(agent.averageRating).to.equal(rating);
      expect(agent.reviewCount).to.equal(1);
    });

    it("Should not allow review without purchase", async function () {
      await expect(marketplaceContract.connect(addrs[0]).submitReview(agentId, 450, "Great agent!"))
        .to.be.revertedWith("You must purchase the agent before reviewing");
    });

    it("Should not allow multiple reviews from same buyer", async function () {
      await marketplaceContract.connect(buyer).submitReview(agentId, 450, "Great agent!");
      
      await expect(marketplaceContract.connect(buyer).submitReview(agentId, 500, "Even better!"))
        .to.be.revertedWith("You have already reviewed this agent");
    });

    it("Should calculate average rating correctly", async function () {
      // First review
      await marketplaceContract.connect(buyer).submitReview(agentId, 400, "Good agent");
      
      // Register another buyer
      await marketplaceContract.connect(addrs[0]).registerUser("Buyer2");
      
      // Second purchase and review
      await marketplaceContract.connect(addrs[0]).purchaseAgent(agentId, { value: agentPrice });
      await marketplaceContract.connect(addrs[0]).submitReview(agentId, 500, "Excellent agent");
      
      // Average should be (400 + 500) / 2 = 450
      const agent = await marketplaceContract.agents(agentId);
      expect(agent.averageRating).to.equal(450);
      expect(agent.reviewCount).to.equal(2);
    });
  });

  describe("Developer Withdrawals", function () {
    let agentId;
    const agentPrice = ethers.utils.parseEther("1");

    beforeEach(async function () {
      // Register users
      await marketplaceContract.connect(developer).registerUser("Developer");
      await marketplaceContract.connect(buyer).registerUser("Buyer");

      // Register and list agent
      await marketplaceContract.connect(developer).registerAgent(
        "Test Agent",
        "A test AI agent",
        "Chatbot",
        agentPrice,
        "QmModelCID",
        "QmMetadataCID",
        "TensorFlow",
        "4GB RAM, 2 CPU cores"
      );
      agentId = 1;
      await marketplaceContract.connect(developer).listAgent(agentId, agentPrice);
      
      // Purchase agent
      await marketplaceContract.connect(buyer).purchaseAgent(agentId, { value: agentPrice });
    });

    it("Should allow developer to withdraw funds", async function () {
      const initialBalance = await ethers.provider.getBalance(developer.address);
      const developerBalance = await marketplaceContract.developerBalances(developer.address);
      
      // Withdraw funds
      const tx = await marketplaceContract.connect(developer).withdrawFunds();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      
      // Check balance after withdrawal
      const finalBalance = await ethers.provider.getBalance(developer.address);
      expect(finalBalance).to.equal(initialBalance.add(developerBalance).sub(gasUsed));
      
      // Check contract balance
      const newDeveloperBalance = await marketplaceContract.developerBalances(developer.address);
      expect(newDeveloperBalance).to.equal(0);
    });

    it("Should not allow withdrawal with zero balance", async function () {
      // Withdraw once
      await marketplaceContract.connect(developer).withdrawFunds();
      
      // Try to withdraw again
      await expect(marketplaceContract.connect(developer).withdrawFunds())
        .to.be.revertedWith("No funds available to withdraw");
    });
  });

  describe("Platform Management", function () {
    it("Should allow owner to update platform fee", async function () {
      const newFee = 300; // 3%
      await marketplaceContract.connect(owner).updatePlatformFee(newFee);
      
      expect(await marketplaceContract.platformFeePercentage()).to.equal(newFee);
    });

    it("Should not allow non-owner to update platform fee", async function () {
      await expect(marketplaceContract.connect(developer).updatePlatformFee(300))
        .to.be.revertedWith("Not authorized: caller is not the owner");
    });

    it("Should not allow platform fee over 10%", async function () {
      await expect(marketplaceContract.connect(owner).updatePlatformFee(1100))
        .to.be.revertedWith("Platform fee cannot exceed 10%");
    });

    it("Should allow owner to transfer ownership", async function () {
      await marketplaceContract.connect(owner).transferOwnership(addrs[0].address);
      
      expect(await marketplaceContract.owner()).to.equal(addrs[0].address);
    });

    it("Should allow owner to pause/unpause contract", async function () {
      await marketplaceContract.connect(owner).setPaused(true);
      expect(await marketplaceContract.paused()).to.equal(true);
      
      await marketplaceContract.connect(owner).setPaused(false);
      expect(await marketplaceContract.paused()).to.equal(false);
    });
  });

  describe("Market Statistics", function () {
    beforeEach(async function () {
      // Register users
      await marketplaceContract.connect(developer).registerUser("Developer");
      await marketplaceContract.connect(buyer).registerUser("Buyer");

      // Register and list agents
      await marketplaceContract.connect(developer).registerAgent(
        "Test Agent 1",
        "A test AI agent",
        "Chatbot",
        ethers.utils.parseEther("1"),
        "QmModelCID1",
        "QmMetadataCID1",
        "TensorFlow",
        "4GB RAM, 2 CPU cores"
      );
      await marketplaceContract.connect(developer).listAgent(1, ethers.utils.parseEther("1"));
      
      await marketplaceContract.connect(developer).registerAgent(
        "Test Agent 2",
        "Another test AI agent",
        "Image Generator",
        ethers.utils.parseEther("2"),
        "QmModelCID2",
        "QmMetadataCID2",
        "PyTorch",
        "8GB RAM, 4 CPU cores"
      );
      await marketplaceContract.connect(developer).listAgent(2, ethers.utils.parseEther("2"));
      
      // Purchase agents
      await marketplaceContract.connect(buyer).purchaseAgent(1, { value: ethers.utils.parseEther("1") });
    });

    it("Should return correct marketplace statistics", async function () {
      const stats = await marketplaceContract.getMarketplaceStats();
      
      expect(stats.totalAgents).to.equal(2);
      expect(stats.totalSales).to.equal(1);
      expect(stats.totalVolume).to.equal(ethers.utils.parseEther("1"));
    });

    it("Should correctly return agent list by category", async function () {
      const chatbots = await marketplaceContract.getAgentsByCategory("Chatbot");
      expect(chatbots.length).to.equal(1);
      expect(chatbots[0]).to.equal(1);
      
      const imageGenerators = await marketplaceContract.getAgentsByCategory("Image Generator");
      expect(imageGenerators.length).to.equal(1);
      expect(imageGenerators[0]).to.equal(2);
    });

    it("Should correctly return developer's agents", async function () {
      const developerAgents = await marketplaceContract.getDeveloperAgents(developer.address);
      expect(developerAgents.length).to.equal(2);
    });

    it("Should correctly identify if user purchased agent", async function () {
      const hasPurchased1 = await marketplaceContract.hasUserPurchasedAgent(buyer.address, 1);
      expect(hasPurchased1).to.equal(true);
      
      const hasPurchased2 = await marketplaceContract.hasUserPurchasedAgent(buyer.address, 2);
      expect(hasPurchased2).to.equal(false);
    });
  });

  describe("Agent Metadata Updates", function () {
    let agentId;

    beforeEach(async function () {
      // Register user
      await marketplaceContract.connect(developer).registerUser("Developer");

      // Register agent
      await marketplaceContract.connect(developer).registerAgent(
        "Test Agent",
        "A test AI agent",
        "Chatbot",
        ethers.utils.parseEther("1"),
        "QmModelCID",
        "QmMetadataCID",
        "TensorFlow",
        "4GB RAM, 2 CPU cores"
      );
      agentId = 1;
    });

    it("Should update agent metadata", async function () {
      await marketplaceContract.connect(developer).updateAgentMetadata(
        agentId,
        "Updated Agent",
        "Updated description",
        "Updated Category",
        "QmUpdatedMetadataCID",
        "PyTorch",
        "8GB RAM, 4 CPU cores"
      );
      
      const agent = await marketplaceContract.agents(agentId);
      expect(agent.name).to.equal("Updated Agent");
      expect(agent.description).to.equal("Updated description");
      expect(agent.category).to.equal("Updated Category");
      expect(agent.metadataCID).to.equal("QmUpdatedMetadataCID");
      expect(agent.framework).to.equal("PyTorch");
      expect(agent.resourceRequirements).to.equal("8GB RAM, 4 CPU cores");
    });

    it("Should update agent model CID", async function () {
      await marketplaceContract.connect(developer).updateAgentModel(agentId, "QmUpdatedModelCID");
      
      const agent = await marketplaceContract.agents(agentId);
      expect(agent.modelCID).to.equal("QmUpdatedModelCID");
    });

    it("Should not allow empty model CID", async function () {
      await expect(marketplaceContract.connect(developer).updateAgentModel(agentId, ""))
        .to.be.revertedWith("Model CID cannot be empty");
    });
  });
});
