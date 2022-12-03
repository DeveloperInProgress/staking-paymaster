// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IStake {
    function rewardToken() external view returns (address);
    function rewardAccumulated(address _staker) external view returns (uint256);
    function addPaymaster(address _paymaster) external;
    function paymasterAdded(address _paymaster) external view returns (bool);
    function getRewardTokenOracleAddress() external view returns (address);
    function withdrawRewards(address _staker, uint256 _amount) external;
}