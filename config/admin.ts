/** Approved Pudge JoyID accounts for service PANEL access only.
 * Registry writes still require the live owner lock. These are public addresses.
 */
export const ADMIN_PANEL_ACCOUNTS = [
  {
    "address": "ckt1qrfrwcdnvssswdwpn3s9v8fp87emat306ctjwsm3nmlkjg8qyza2cqgqqyzpymajakggxzyk2nzzr276prl9q2d43cx3z043",
    "lockHash": "0xaeabffb948d742b90026ff00362e353bbe2ec7a4762f586fd266031890fceb80"
  },
  {
    "address": "ckt1qrfrwcdnvssswdwpn3s9v8fp87emat306ctjwsm3nmlkjg8qyza2cqgqq8f3nr43ulmmqn4vv9nmw0m8xx27wah69ym85z9a",
    "lockHash": "0xad93b292b49e3a08251b4fd7f47a0b09db84f024a32a38a6e20bf023ad915048"
  },
  {
    "address": "ckt1qrfrwcdnvssswdwpn3s9v8fp87emat306ctjwsm3nmlkjg8qyza2cqgqq83pvdplqmgdxudn76xykagx43qyauzpsvsn7y09",
    "lockHash": "0x21ea19b046900321550056f32138001015b58ba6d5d84484df09821da89b3fdc"
  },
  {
    "address": "ckt1qrfrwcdnvssswdwpn3s9v8fp87emat306ctjwsm3nmlkjg8qyza2cqgqq9qha8uqganyw9aavyyqeltvrlg59lp4svl02uvq",
    "lockHash": "0xe75d9c7a62d06c1e063eead8d13e8ef6cd08a864b3e4f481e82df0798fdd15a0"
  },
  {
    "address": "ckt1qrfrwcdnvssswdwpn3s9v8fp87emat306ctjwsm3nmlkjg8qyza2cqgqqyd2z7z0zcrggqlg9hhn0kfdqluzxwgxxyx5gac9",
    "lockHash": "0x9349bca4e082af23f0139dc3da4fb108d32d3c2e26cbea90113afa4368255e2d"
  }
] as const;
export const ADMIN_PANEL_LOCK_HASHES: readonly string[] = ADMIN_PANEL_ACCOUNTS.map(account => account.lockHash);
