// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../interfaces/IStake.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Mock is IERC20 {
    function mint(address _to, uint256 _amount) external;
}

contract MockStake is IStake, Ownable {
    address public immutable rewardToken;
    address oracle;
    uint256 rewards;

    mapping(address => bool) paymasters;

    constructor(address _rewardToken, address _oracle) {
        rewardToken = _rewardToken;
        oracle = _oracle;
    }

    function rewardAccumulated(address _staker) public view returns (uint256) {
        return rewards;
    }

    function setRewards(uint256 _reward) external {
        rewards = _reward;
    }

    function addPaymaster(address _paymaster) external onlyOwner {
        require(_paymaster != address(0), "MockStake: Null address");

        paymasters[_paymaster] = true;
    }

    function paymasterAdded(address _paymaster) external view returns (bool) {
        return paymasters[_paymaster];
    }

    function withdrawRewards(address _staker, uint256 _amount) external {
        require(
            _staker == msg.sender || paymasters[msg.sender],
            "MockStake: Insufficient Allowance"
        );
        require(
            _amount < rewardAccumulated(_staker),
            "MockStake: Insufficient Rewards"
        );

        IERC20Mock token = IERC20Mock(rewardToken);
        token.mint(msg.sender, _amount);
    }

    function getRewardTokenOracleAddress() external view returns (address) {
        return oracle;
    }
}
