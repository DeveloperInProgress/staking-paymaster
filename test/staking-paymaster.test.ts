import './aa.init'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  SimpleAccount,
  SimpleAccount__factory,
  EntryPoint,
  DepositPaymaster,
  DepositPaymaster__factory,
  TestOracle__factory,
  TestCounter,
  TestCounter__factory,
  TestToken,
  TestToken__factory,
  StakingPaymaster__factory,
  MockStake,
  MockStake__factory,
  StakingPaymaster
} from '../typechain'
import {
  AddressZero, createAddress,
  createAccountOwner,
  deployEntryPoint, FIVE_ETH, ONE_ETH, simulationResultCatch, userOpsWithoutAgg
} from './testutils'
import { fillAndSign } from './UserOp'
import { hexConcat, hexZeroPad, parseEther } from 'ethers/lib/utils'

describe('StakingPaymaster', () => {
  let entryPoint: EntryPoint
  const ethersSigner = ethers.provider.getSigner()
  let token: TestToken
  let stake: MockStake
  let paymaster: StakingPaymaster
  before(async function () {
    entryPoint = await deployEntryPoint()

    token = await new TestToken__factory(ethersSigner).deploy()
    const testOracle = await new TestOracle__factory(ethersSigner).deploy()

    stake = await new MockStake__factory(ethersSigner).deploy(token.address, testOracle.address)
    paymaster = await new StakingPaymaster__factory(ethersSigner).deploy(entryPoint.address)
    await paymaster.addStake(1, { value: parseEther('2') })
    await entryPoint.depositTo(paymaster.address, { value: parseEther('1') })

    await paymaster.addStakingContract(stake.address);

    await stake.addPaymaster(paymaster.address);
    await token.mint(await ethersSigner.getAddress(), FIVE_ETH)
    await token.approve(paymaster.address, ethers.constants.MaxUint256)
  })

  describe('deposit', () => {
    let account: SimpleAccount

    before(async () => {
      account = await new SimpleAccount__factory(ethersSigner).deploy(entryPoint.address, await ethersSigner.getAddress())
    })
    it('should deposit and read balance', async () => {
      await paymaster.addDepositFor(token.address, account.address, 100)
      expect(await paymaster.depositInfo(token.address, account.address)).to.eql({ amount: 100 })
    })
    it('should fail to withdraw without unlock', async () => {
      const paymasterWithdraw = await paymaster.populateTransaction.withdrawTokensTo(token.address, AddressZero, 1).then(tx => tx.data!)

      await expect(
        account.exec(paymaster.address, 0, paymasterWithdraw)
      ).to.revertedWith('DepositPaymaster: must unlockTokenDeposit')
    })
    it('should fail to withdraw within the same block ', async () => {
      const paymasterUnlock = await paymaster.populateTransaction.unlockTokenDeposit().then(tx => tx.data!)
      const paymasterWithdraw = await paymaster.populateTransaction.withdrawTokensTo(token.address, AddressZero, 1).then(tx => tx.data!)

      await expect(
        account.execBatch([paymaster.address, paymaster.address], [paymasterUnlock, paymasterWithdraw])
      ).to.be.revertedWith('DepositPaymaster: must unlockTokenDeposit')
    })
    it('should succeed to withdraw after unlock', async () => {
      const paymasterUnlock = await paymaster.populateTransaction.unlockTokenDeposit().then(tx => tx.data!)
      const target = createAddress()
      const paymasterWithdraw = await paymaster.populateTransaction.withdrawTokensTo(token.address, target, 1).then(tx => tx.data!)
      await account.exec(paymaster.address, 0, paymasterUnlock)
      await account.exec(paymaster.address, 0, paymasterWithdraw)
      expect(await token.balanceOf(target)).to.eq(1)
    })
  })

  describe('#validatePaymasterUserOp', () => {
    let account: SimpleAccount
    const gasPrice = 1e9
    let accountOwner: string

    before(async () => {
      accountOwner = await ethersSigner.getAddress()
      account = await new SimpleAccount__factory(ethersSigner).deploy(entryPoint.address, accountOwner)
    
      await token.mint(account.address, FIVE_ETH);
      await token.connect(ethersSigner).approve(paymaster.address, ONE_ETH)
    })

    it('should fail if no staking contract', async () => {
      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: paymaster.address
      }, ethersSigner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(userOp)).to.be.revertedWith('StakingPaymaster: paymasterData must specify staking contract')
    })

    it('should fail with wrong staking contract', async () => {
      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, hexZeroPad('0x1234', 20)])
      }, ethersSigner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(userOp, { gasPrice })).to.be.revertedWith('StakingPaymaster: Invalid staking contract')
    })

    it('should reject if no deposit', async () => {
      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, hexZeroPad(stake.address, 20)])
      }, ethersSigner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(userOp, { gasPrice })).to.be.revertedWith('StakingPaymaster: deposit too low')
    })

    it('should reject if deposit is not locked', async () => {
      await paymaster.addDepositFor(token.address, account.address, ONE_ETH)

      const paymasterUnlock = await paymaster.populateTransaction.unlockTokenDeposit().then(tx => tx.data!)
      await account.exec(paymaster.address, 0, paymasterUnlock)

      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, hexZeroPad(stake.address, 20)])
      }, ethersSigner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(userOp, { gasPrice })).to.be.revertedWith('not locked')
    })

    it('succeed with valid deposit', async () => {
      // needed only if previous test did unlock.
      const paymasterLockTokenDeposit = await paymaster.populateTransaction.lockTokenDeposit().then(tx => tx.data!)
      await account.exec(paymaster.address, 0, paymasterLockTokenDeposit)

      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, hexZeroPad(stake.address, 20)])
      }, ethersSigner, entryPoint);
      //throw new Error(hexConcat([paymaster.address, hexZeroPad(stake.address, 20)]))
      //throw new Error(paymaster.address.length.toString())
      //throw new Error(hexZeroPad(stake.address, 20))
      //throw new Error(userOp.paymasterAndData.length.toString())
      await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
    })
  })
  describe('#handleOps', async () => {
    let account: SimpleAccount
    const [accountOwner] = await ethers.getSigners();
    let counter: TestCounter
    let callData: string
    before(async () => {
        account = await new SimpleAccount__factory(ethersSigner).deploy(entryPoint.address, accountOwner.address)
        counter = await new TestCounter__factory(ethersSigner).deploy()
        const counterJustEmit = await counter.populateTransaction.justemit().then(tx => tx.data!)
        callData = await account.populateTransaction.execFromEntryPoint(counter.address, 0, counterJustEmit).then(tx => tx.data!)
        await token.mint(account.address, ONE_ETH);
        await token.connect(accountOwner).approve(paymaster.address, ONE_ETH)
        await paymaster.addDepositFor(token.address, account.address, ONE_ETH)
    })
    it('should pay with deposit (and revert user\'s call) if user can\'t pay with stake rewards', async () => {
      const beneficiary = createAddress()
      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, hexZeroPad(stake.address, 20)]),
        callData
      }, accountOwner, entryPoint)

      await entryPoint.handleAggregatedOps(userOpsWithoutAgg([userOp]), beneficiary)

      const [log] = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent())
      expect(log.args.success).to.eq(false)
      expect(await counter.queryFilter(counter.filters.CalledFrom())).to.eql([])
      expect(await ethers.provider.getBalance(beneficiary)).to.be.gt(0)
    })

    it('should pay with stake if available', async () => {
      const beneficiary = createAddress()
      const beneficiary1 = createAddress()
      const rewards = parseEther('1')
      await stake.setRewards(rewards)

      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, hexZeroPad(token.address, 20)]),
        callData
      }, accountOwner, entryPoint)
      await entryPoint.handleAggregatedOps(userOpsWithoutAgg([userOp]), beneficiary)

      const [log] = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), await ethers.provider.getBlockNumber())
      expect(log.args.success).to.eq(true)
      const charge = log.args.actualGasCost
      expect(await ethers.provider.getBalance(beneficiary)).to.eq(charge)

      const targetLogs = await counter.queryFilter(counter.filters.CalledFrom())
      expect(targetLogs.length).to.eq(1)
    })
  })
})
