/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/autark.json`.
 */
export type Autark = {
  "address": "FgkicN5V1fYLFJaY6nH9er3vvCr1nJCQVA9Wy7e3kLhy",
  "metadata": {
    "name": "autark",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "acceptBid",
      "docs": [
        "Produces an Accepted JobOffer that settles via the unchanged",
        "release_escrow + claim_settlement instructions — no parallel",
        "bounty-specific settlement path."
      ],
      "discriminator": [
        196,
        191,
        1,
        229,
        144,
        172,
        122,
        227
      ],
      "accounts": [
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "poster"
              },
              {
                "kind": "arg",
                "path": "bountyId"
              }
            ]
          },
          "relations": [
            "bid"
          ]
        },
        {
          "name": "bid",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "bounty"
              },
              {
                "kind": "account",
                "path": "bid.bidder",
                "account": "bid"
              }
            ]
          }
        },
        {
          "name": "jobOffer",
          "docs": [
            "The JobOffer this awarded bounty becomes. Same shape, same PDA seeds",
            "scheme ([\"job\", consumer, job_id_32]) as targeted-hire jobs — the",
            "bounty's own pubkey bytes serve as job_id, since a bounty awards at",
            "most one job. release_escrow/claim_settlement do not know or care",
            "whether a JobOffer originated from propose_job or accept_bid."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "poster"
              },
              {
                "kind": "account",
                "path": "bounty"
              }
            ]
          }
        },
        {
          "name": "jobEscrowVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "jobOffer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "bountyEscrowVault",
          "writable": true
        },
        {
          "name": "posterTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "poster"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "providerAgent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bid.bidder",
                "account": "bid"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "poster",
          "writable": true,
          "signer": true,
          "relations": [
            "bounty"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bountyId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "acceptJob",
      "discriminator": [
        43,
        201,
        124,
        1,
        19,
        189,
        96,
        10
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "agent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "provider"
              }
            ]
          }
        },
        {
          "name": "provider",
          "signer": true,
          "relations": [
            "jobOffer"
          ]
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "addWhitelistedMint",
      "discriminator": [
        197,
        167,
        100,
        8,
        245,
        152,
        234,
        87
      ],
      "accounts": [
        {
          "name": "mintWhitelist",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "mintWhitelist"
          ]
        }
      ],
      "args": [
        {
          "name": "mint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "cancelBounty",
      "discriminator": [
        79,
        65,
        107,
        143,
        128,
        165,
        135,
        46
      ],
      "accounts": [
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "poster"
              },
              {
                "kind": "arg",
                "path": "bountyId"
              }
            ]
          }
        },
        {
          "name": "escrowVault",
          "writable": true
        },
        {
          "name": "posterTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "poster"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "poster",
          "writable": true,
          "signer": true,
          "relations": [
            "bounty"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "bountyId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "cancelExpiredJob",
      "docs": [
        "Anyone may crank this. Branches on Proposed->Expired (ghosted",
        "acceptance) vs Accepted->Abandoned (ghosted delivery) — see",
        "expiry.rs for the two slash formulas."
      ],
      "discriminator": [
        140,
        225,
        133,
        15,
        106,
        212,
        83,
        145
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "escrowVault",
          "writable": true
        },
        {
          "name": "consumerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "providerAgent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.provider",
                "account": "jobOffer"
              }
            ]
          }
        },
        {
          "name": "providerStakeVault",
          "writable": true
        },
        {
          "name": "slashingPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  108,
                  97,
                  115,
                  104,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "slashingPoolVault",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "cranker",
          "docs": [
            "Anyone may crank this."
          ],
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "challengeSettlement",
      "discriminator": [
        124,
        204,
        242,
        137,
        177,
        7,
        153,
        173
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "challenge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  108,
                  108,
                  101,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "jobOffer"
              }
            ]
          }
        },
        {
          "name": "stakeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "challenge"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "consumerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "consumer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "consumer",
          "writable": true,
          "signer": true,
          "relations": [
            "jobOffer"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "claimSettlement",
      "docs": [
        "Single settlement primitive — see settlement.rs. Reused by awarded",
        "bounties in Tier 1b; do not add a parallel claim path for those."
      ],
      "discriminator": [
        85,
        208,
        73,
        229,
        143,
        98,
        83,
        212
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "providerAgent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.provider",
                "account": "jobOffer"
              }
            ]
          }
        },
        {
          "name": "escrowVault",
          "writable": true
        },
        {
          "name": "providerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "providerWallet"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "providerWallet",
          "docs": [
            "authenticity enforced by the `address = job_offer.provider` constraint."
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "cranker",
          "docs": [
            "Anyone may crank settlement — no constraint beyond being a fee payer."
          ],
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "closeBid",
      "discriminator": [
        169,
        171,
        66,
        115,
        220,
        168,
        231,
        21
      ],
      "accounts": [
        {
          "name": "bounty"
        },
        {
          "name": "bid",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "bounty"
              },
              {
                "kind": "account",
                "path": "bidder"
              }
            ]
          }
        },
        {
          "name": "bidder",
          "writable": true,
          "signer": true,
          "relations": [
            "bid"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "defendChallenge",
      "discriminator": [
        28,
        49,
        245,
        112,
        194,
        37,
        252,
        102
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "challenge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  108,
                  108,
                  101,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "jobOffer"
              }
            ]
          }
        },
        {
          "name": "stakeVault",
          "writable": true
        },
        {
          "name": "providerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "provider"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "provider",
          "writable": true,
          "signer": true,
          "relations": [
            "jobOffer"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "initMintWhitelist",
      "discriminator": [
        182,
        5,
        134,
        4,
        66,
        107,
        219,
        92
      ],
      "accounts": [
        {
          "name": "mintWhitelist",
          "docs": [
            "Whoever calls this becomes the deployer authority for all config."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initSlashingPool",
      "discriminator": [
        79,
        22,
        178,
        162,
        168,
        131,
        243,
        41
      ],
      "accounts": [
        {
          "name": "mintWhitelist",
          "docs": [
            "Same deployer authority as the mint whitelist gates this too."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "slashingPool",
          "docs": [
            "Singleton — v1 is USDC-only, so the program supports exactly one pool."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  108,
                  97,
                  115,
                  104,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "slashingPool"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "mintWhitelist"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "postBounty",
      "discriminator": [
        40,
        217,
        222,
        103,
        151,
        83,
        147,
        130
      ],
      "accounts": [
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "poster"
              },
              {
                "kind": "arg",
                "path": "bountyId"
              }
            ]
          }
        },
        {
          "name": "mintWhitelist",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "escrowVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "bounty"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "posterTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "poster"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "poster",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bountyId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "capabilityRequired",
          "type": "string"
        },
        {
          "name": "maxAmount",
          "type": "u64"
        },
        {
          "name": "minReputation",
          "type": "u32"
        },
        {
          "name": "biddingDeadline",
          "type": "i64"
        },
        {
          "name": "deliveryDeadline",
          "type": "i64"
        },
        {
          "name": "challengeWindowSeconds",
          "type": "u32"
        },
        {
          "name": "defenseWindowSeconds",
          "type": "u32"
        }
      ]
    },
    {
      "name": "proposeJob",
      "discriminator": [
        104,
        249,
        132,
        85,
        87,
        89,
        168,
        131
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "consumer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "mintWhitelist",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "escrowVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "jobOffer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "consumerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "consumer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "consumer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "provider",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "acceptanceDeadline",
          "type": "i64"
        },
        {
          "name": "deliveryDeadline",
          "type": "i64"
        },
        {
          "name": "challengeWindowSeconds",
          "type": "u32"
        },
        {
          "name": "defenseWindowSeconds",
          "type": "u32"
        }
      ]
    },
    {
      "name": "registerAgent",
      "discriminator": [
        135,
        157,
        66,
        195,
        2,
        113,
        175,
        30
      ],
      "accounts": [
        {
          "name": "agent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "mintWhitelist",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "stakeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "agent"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "ownerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "capabilities",
          "type": {
            "vec": "string"
          }
        },
        {
          "name": "endpointUrl",
          "type": "string"
        },
        {
          "name": "initialStake",
          "type": "u64"
        }
      ]
    },
    {
      "name": "rejectJob",
      "docs": [
        "Honest voluntary decline, Proposed only — no slash."
      ],
      "discriminator": [
        94,
        15,
        241,
        118,
        161,
        177,
        128,
        101
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "escrowVault",
          "writable": true
        },
        {
          "name": "consumerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "provider",
          "signer": true,
          "relations": [
            "jobOffer"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "releaseEscrow",
      "discriminator": [
        146,
        253,
        129,
        233,
        20,
        145,
        181,
        206
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "provider",
          "signer": true,
          "relations": [
            "jobOffer"
          ]
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "resolveChallenge",
      "docs": [
        "Anyone may crank this once defense_deadline has passed. See",
        "dispute.rs for the two resolution branches."
      ],
      "discriminator": [
        81,
        191,
        124,
        119,
        131,
        248,
        157,
        109
      ],
      "accounts": [
        {
          "name": "jobOffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "challenge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  108,
                  108,
                  101,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "jobOffer"
              }
            ]
          }
        },
        {
          "name": "challenger",
          "docs": [
            "enforced by the `address = challenge.challenger` constraint."
          ],
          "writable": true
        },
        {
          "name": "escrowVault",
          "writable": true
        },
        {
          "name": "challengeStakeVault",
          "writable": true
        },
        {
          "name": "slashingPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  108,
                  97,
                  115,
                  104,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "slashingPoolVault",
          "writable": true
        },
        {
          "name": "providerAgent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "job_offer.provider",
                "account": "jobOffer"
              }
            ]
          }
        },
        {
          "name": "providerStakeVault",
          "writable": true
        },
        {
          "name": "consumerAgent",
          "docs": [
            "Optional: only present if the consumer happens to also be a",
            "registered Agent. See the handler's defended branch."
          ],
          "optional": true
        },
        {
          "name": "consumerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job_offer.consumer",
                "account": "jobOffer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "providerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job_offer.provider",
                "account": "jobOffer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "cranker",
          "docs": [
            "Anyone may crank this once defense_deadline has passed."
          ],
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "stakeDeposit",
      "discriminator": [
        75,
        168,
        115,
        239,
        194,
        115,
        22,
        98
      ],
      "accounts": [
        {
          "name": "agent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "stakeVault",
          "writable": true
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "agent"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "stakeWithdraw",
      "discriminator": [
        199,
        13,
        168,
        20,
        92,
        151,
        29,
        56
      ],
      "accounts": [
        {
          "name": "agent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "stakeVault",
          "writable": true
        },
        {
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "agent"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "submitBid",
      "discriminator": [
        19,
        164,
        237,
        254,
        64,
        139,
        237,
        93
      ],
      "accounts": [
        {
          "name": "bounty",
          "writable": true
        },
        {
          "name": "bidderAgent",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bidder"
              }
            ]
          }
        },
        {
          "name": "bid",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "bounty"
              },
              {
                "kind": "account",
                "path": "bidder"
              }
            ]
          }
        },
        {
          "name": "bidder",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "deliveryDeadline",
          "type": "i64"
        }
      ]
    },
    {
      "name": "updateAgentCapabilities",
      "discriminator": [
        138,
        23,
        94,
        120,
        222,
        75,
        58,
        217
      ],
      "accounts": [
        {
          "name": "agent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "agent"
          ]
        }
      ],
      "args": [
        {
          "name": "newCapabilities",
          "type": {
            "vec": "string"
          }
        },
        {
          "name": "newEndpointUrl",
          "type": "string"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "agent",
      "discriminator": [
        47,
        166,
        112,
        147,
        155,
        197,
        86,
        7
      ]
    },
    {
      "name": "bid",
      "discriminator": [
        143,
        246,
        48,
        245,
        42,
        145,
        180,
        88
      ]
    },
    {
      "name": "bounty",
      "discriminator": [
        237,
        16,
        105,
        198,
        19,
        69,
        242,
        234
      ]
    },
    {
      "name": "challenge",
      "discriminator": [
        119,
        250,
        161,
        121,
        119,
        81,
        22,
        208
      ]
    },
    {
      "name": "jobOffer",
      "discriminator": [
        214,
        34,
        36,
        177,
        199,
        167,
        118,
        37
      ]
    },
    {
      "name": "mintWhitelist",
      "discriminator": [
        21,
        127,
        24,
        53,
        117,
        168,
        234,
        153
      ]
    },
    {
      "name": "slashingPool",
      "discriminator": [
        37,
        105,
        14,
        77,
        191,
        79,
        171,
        163
      ]
    }
  ],
  "events": [
    {
      "name": "bidSubmitted",
      "discriminator": [
        116,
        72,
        108,
        240,
        175,
        70,
        56,
        22
      ]
    },
    {
      "name": "bountyAwarded",
      "discriminator": [
        230,
        101,
        91,
        225,
        16,
        230,
        193,
        102
      ]
    },
    {
      "name": "bountyPosted",
      "discriminator": [
        61,
        61,
        26,
        239,
        184,
        44,
        139,
        232
      ]
    },
    {
      "name": "challengeDefended",
      "discriminator": [
        49,
        57,
        148,
        9,
        137,
        113,
        228,
        247
      ]
    },
    {
      "name": "challengeOpened",
      "discriminator": [
        42,
        83,
        165,
        62,
        80,
        17,
        63,
        181
      ]
    },
    {
      "name": "challengeResolved",
      "discriminator": [
        100,
        153,
        38,
        123,
        172,
        250,
        166,
        105
      ]
    },
    {
      "name": "jobAbandoned",
      "discriminator": [
        206,
        239,
        135,
        191,
        120,
        190,
        112,
        211
      ]
    },
    {
      "name": "jobAccepted",
      "discriminator": [
        47,
        54,
        152,
        59,
        118,
        195,
        251,
        114
      ]
    },
    {
      "name": "jobExpired",
      "discriminator": [
        213,
        123,
        115,
        173,
        157,
        242,
        12,
        71
      ]
    },
    {
      "name": "jobProposed",
      "discriminator": [
        96,
        186,
        35,
        186,
        121,
        57,
        252,
        91
      ]
    },
    {
      "name": "jobRejected",
      "discriminator": [
        23,
        78,
        227,
        57,
        28,
        0,
        197,
        216
      ]
    },
    {
      "name": "jobSettled",
      "discriminator": [
        130,
        105,
        205,
        34,
        87,
        86,
        152,
        27
      ]
    },
    {
      "name": "settlementPendingEvent",
      "discriminator": [
        63,
        188,
        214,
        13,
        244,
        190,
        73,
        252
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer is not authorized for this action"
    },
    {
      "code": 6001,
      "name": "invalidStatus",
      "msg": "Account is not in the required status for this action"
    },
    {
      "code": 6002,
      "name": "stakeTooLow",
      "msg": "Stake amount is below the required minimum"
    },
    {
      "code": 6003,
      "name": "deadlinePassed",
      "msg": "Deadline has passed"
    },
    {
      "code": 6004,
      "name": "mintNotWhitelisted",
      "msg": "Mint is not on the whitelist"
    },
    {
      "code": 6005,
      "name": "mintAlreadyWhitelisted",
      "msg": "Mint is already on the whitelist"
    },
    {
      "code": 6006,
      "name": "mintWhitelistFull",
      "msg": "Mint whitelist is full"
    },
    {
      "code": 6007,
      "name": "amountZero",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6008,
      "name": "invalidDeadlines",
      "msg": "Deadlines invalid: acceptance must be before delivery"
    },
    {
      "code": 6009,
      "name": "notProvider",
      "msg": "Signer is not the provider for this job"
    },
    {
      "code": 6010,
      "name": "agentHasOpenJobs",
      "msg": "Agent has open jobs and cannot withdraw stake"
    },
    {
      "code": 6011,
      "name": "stakeBelowMinimum",
      "msg": "Resulting stake would fall below the required minimum"
    },
    {
      "code": 6012,
      "name": "acceptanceWindowNotExpired",
      "msg": "Acceptance deadline has not yet passed"
    },
    {
      "code": 6013,
      "name": "challengeWindowNotElapsed",
      "msg": "Challenge window has not yet elapsed"
    },
    {
      "code": 6014,
      "name": "insufficientFunds",
      "msg": "Insufficient funds for this transfer"
    },
    {
      "code": 6015,
      "name": "tooManyCapabilities",
      "msg": "Agent has too many capability tags"
    },
    {
      "code": 6016,
      "name": "capabilityTooLong",
      "msg": "Capability tag exceeds the maximum length"
    },
    {
      "code": 6017,
      "name": "endpointTooLong",
      "msg": "Endpoint URL exceeds the maximum length"
    },
    {
      "code": 6018,
      "name": "bidPriceTooHigh",
      "msg": "Bid price exceeds the bounty's max amount"
    },
    {
      "code": 6019,
      "name": "reputationTooLow",
      "msg": "Bidder's completed-job reputation is below the bounty's minimum"
    },
    {
      "code": 6020,
      "name": "bidNotForBounty",
      "msg": "Bid does not belong to this bounty"
    },
    {
      "code": 6021,
      "name": "notConsumer",
      "msg": "Signer is not the consumer for this job"
    },
    {
      "code": 6022,
      "name": "challengeWindowClosed",
      "msg": "Challenge window has already closed — crank claim_settlement instead"
    },
    {
      "code": 6023,
      "name": "defenseDeadlinePassed",
      "msg": "Defense deadline has already passed"
    },
    {
      "code": 6024,
      "name": "defenseWindowNotElapsed",
      "msg": "Defense window has not yet elapsed"
    },
    {
      "code": 6025,
      "name": "deliveryWindowNotExpired",
      "msg": "Delivery deadline has not yet passed"
    }
  ],
  "types": [
    {
      "name": "agent",
      "docs": [
        "seeds: [\"agent\", owner]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "capabilities",
            "docs": [
              "<=8 tags, <=32 chars each"
            ],
            "type": {
              "vec": "string"
            }
          },
          {
            "name": "endpointUrl",
            "type": "string"
          },
          {
            "name": "stakeAmount",
            "type": "u64"
          },
          {
            "name": "stakeVault",
            "type": "pubkey"
          },
          {
            "name": "scoreCompleted",
            "type": "u64"
          },
          {
            "name": "scoreFailed",
            "type": "u64"
          },
          {
            "name": "scoreVolume",
            "type": "u64"
          },
          {
            "name": "slashEvents",
            "type": "u32"
          },
          {
            "name": "lastSlashSlot",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "openJobs",
            "docs": [
              "# of non-terminal jobs where this agent is provider.",
              "Incremented on accept_job, decremented when a job reaches a terminal",
              "state. stake_withdraw requires open_jobs == 0."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "bid",
      "docs": [
        "seeds: [\"bid\", bounty, bidder]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "bidder",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "deliveryDeadline",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bidSubmitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "bidder",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bounty",
      "docs": [
        "seeds: [\"bounty\", poster, bounty_id_32]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poster",
            "type": "pubkey"
          },
          {
            "name": "capabilityRequired",
            "type": "string"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "maxAmount",
            "type": "u64"
          },
          {
            "name": "escrowVault",
            "type": "pubkey"
          },
          {
            "name": "minReputation",
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "bountyStatus"
              }
            }
          },
          {
            "name": "winningBid",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "biddingDeadline",
            "type": "i64"
          },
          {
            "name": "deliveryDeadline",
            "type": "i64"
          },
          {
            "name": "challengeWindowSeconds",
            "docs": [
              "Copied onto the awarded JobOffer's challenge_window_seconds."
            ],
            "type": "u32"
          },
          {
            "name": "defenseWindowSeconds",
            "docs": [
              "Copied onto the awarded JobOffer's defense_window_seconds."
            ],
            "type": "u32"
          },
          {
            "name": "budgetEscrow",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "depth",
            "type": "u8"
          },
          {
            "name": "parentJob",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "bidCount",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bountyAwarded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "poster",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "refundToPoster",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bountyPosted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "poster",
            "type": "pubkey"
          },
          {
            "name": "capabilityRequired",
            "type": "string"
          },
          {
            "name": "maxAmount",
            "type": "u64"
          },
          {
            "name": "minReputation",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "bountyStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "bidding"
          },
          {
            "name": "awarded"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "challenge",
      "docs": [
        "seeds: [\"challenge\", job]  -- externalized dispute state"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "challenger",
            "docs": [
              "= job.consumer at challenge time"
            ],
            "type": "pubkey"
          },
          {
            "name": "defender",
            "docs": [
              "= job.provider"
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "stakeVault",
            "docs": [
              "ATA owned by this PDA, holds BOTH stakes."
            ],
            "type": "pubkey"
          },
          {
            "name": "challengeStake",
            "docs": [
              "== job.amount"
            ],
            "type": "u64"
          },
          {
            "name": "defenseStake",
            "docs": [
              "0 until defended"
            ],
            "type": "u64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "challengeState"
              }
            }
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "defenseDeadline",
            "type": "i64"
          },
          {
            "name": "defendedAt",
            "docs": [
              "0 if never defended"
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "challengeDefended",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "defender",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "challengeOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "challenger",
            "type": "pubkey"
          },
          {
            "name": "defender",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "defenseDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "challengeResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "defended",
            "type": "bool"
          },
          {
            "name": "consumerRefund",
            "type": "u64"
          },
          {
            "name": "providerPayout",
            "type": "u64"
          },
          {
            "name": "slashed",
            "type": "u64"
          },
          {
            "name": "providerScoreCompleted",
            "docs": [
              "POST-update provider Agent counters — the dashboard reads the slash",
              "straight off this event, no re-fetch."
            ],
            "type": "u64"
          },
          {
            "name": "providerScoreVolume",
            "type": "u64"
          },
          {
            "name": "providerScoreFailed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "challengeState",
      "docs": [
        "Account closes on resolve, so there is no Resolved variant."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "defended"
          }
        ]
      }
    },
    {
      "name": "jobAbandoned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "refunded",
            "type": "u64"
          },
          {
            "name": "slashed",
            "type": "u64"
          },
          {
            "name": "scoreFailed",
            "docs": [
              "POST-update provider Agent counters."
            ],
            "type": "u64"
          },
          {
            "name": "slashEvents",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "jobAccepted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "stakeLocked",
            "type": "u64"
          },
          {
            "name": "providerOpenJobs",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "jobExpired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "refunded",
            "type": "u64"
          },
          {
            "name": "slashed",
            "type": "u64"
          },
          {
            "name": "scoreFailed",
            "docs": [
              "POST-update provider Agent counter. slash_events is deliberately",
              "absent: per the reputation table, Expired does NOT bump slash_events",
              "(unlike Abandoned / lost-challenge) — see the handler comment."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "jobOffer",
      "docs": [
        "seeds: [\"job\", consumer, job_id_32]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "consumer",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "escrowVault",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "jobStatus"
              }
            }
          },
          {
            "name": "budgetEscrow",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "depth",
            "type": "u8"
          },
          {
            "name": "parentJob",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "acceptanceDeadline",
            "type": "i64"
          },
          {
            "name": "deliveryDeadline",
            "type": "i64"
          },
          {
            "name": "challengeWindowSeconds",
            "docs": [
              "Gates the challenge window."
            ],
            "type": "u32"
          },
          {
            "name": "defenseWindowSeconds",
            "docs": [
              "Gates how long a provider has to defend an opened challenge before",
              "resolve_challenge can be cranked. Parallels challenge_window_seconds:",
              "a per-job param, not a hardcoded constant."
            ],
            "type": "u32"
          },
          {
            "name": "settlementPendingAt",
            "docs": [
              "Set on release_escrow."
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "counterCount",
            "type": "u8"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "providerStakeLocked",
            "docs": [
              "Earmark recorded at accept_job = min(agent.stake_amount, job.amount).",
              "Tier 1 only sets/clears it; Tier 2 slashing will read it. Released",
              "(logically) on settle."
            ],
            "type": "u64"
          },
          {
            "name": "jobId",
            "docs": [
              "The 32-byte seed used to derive this PDA. Stored so providers can",
              "discover targeted-hire jobs via a provider memcmp scan and reconstruct",
              "the PDA without an out-of-band hint."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "jobProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "consumer",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "deliveryDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "jobRejected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "refunded",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "jobSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "scoreCompleted",
            "docs": [
              "POST-update provider Agent counters."
            ],
            "type": "u64"
          },
          {
            "name": "scoreVolume",
            "type": "u64"
          },
          {
            "name": "scoreFailed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "jobStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "proposed"
          },
          {
            "name": "countered"
          },
          {
            "name": "accepted"
          },
          {
            "name": "settlementPending"
          },
          {
            "name": "challenged"
          },
          {
            "name": "settled"
          },
          {
            "name": "rejected"
          },
          {
            "name": "expired"
          },
          {
            "name": "abandoned"
          },
          {
            "name": "burned"
          }
        ]
      }
    },
    {
      "name": "mintWhitelist",
      "docs": [
        "seeds: [\"mint_whitelist\"]  (global singleton)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mints",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "settlementPendingEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "settleEligibleAt",
            "docs": [
              "settlement_pending_at + challenge_window_seconds."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "slashingPool",
      "docs": [
        "seeds: [\"slashing_pool\"]  (singleton)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "totalSlashed",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
