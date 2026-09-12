# Source attribution

The V3 module is a browser-native TypeScript implementation of the locked handoff and public CKBFS V3 specification. The source review used these exact checkouts:

- [toastmanAu/ckbfs-browser](https://github.com/toastmanAu/ckbfs-browser/tree/e6b92233c501f2097bf53e7e41cc405cc35fc9ad) — `e6b92233c501f2097bf53e7e41cc405cc35fc9ad`
- [toastmanAu/ckbfs-viewer](https://github.com/toastmanAu/ckbfs-viewer/tree/97819ea7f43d2fbae623a14a39ff9d4ea2391ffa) — `97819ea7f43d2fbae623a14a39ff9d4ea2391ffa`
- [code-monad/ckbfs-api](https://github.com/code-monad/ckbfs-api/tree/2fde9b16be9bf49ac4d71235c00ba957ecc78870) — `2fde9b16be9bf49ac4d71235c00ba957ecc78870`

Publisher input/witness ordering concepts come from the owner’s `ckbfs-browser` repository. Its MIT notice is preserved in `licenses/ckbfs-browser.MIT.txt`. The legacy resolver and V2 codecs were not copied. The viewer informed isolated rendering lifecycle design. The implemented player uses a dedicated sandbox page with nested srcdoc rather than injecting markup into React.

The upstream API was used to cross-check deployment constants, Molecule field order and backlink semantics. It is not a runtime dependency. No Node-only upstream transaction implementation was copied. See [the V3 RFC](https://github.com/code-monad/ckbfs/blob/master/RFC.v3.md).

CCC supplies transaction encoding, Type ID derivation, CKB-personalized Blake2b and JoyID integration. Exact direct pins: core 1.19.1; connector-react 1.1.9. Third-party dependencies retain their own licenses in their package distributions. The handoff documents remain owned by their original authors.
