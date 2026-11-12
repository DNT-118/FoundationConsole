# 发布签名公钥

GitHub Release 中的发布包使用 Ed25519 签名（OpenSSL 3）。公钥文件为本目录下的 `fdc-release.pub.pem`，由仓库所有者生成后提交；私钥只保存在仓库 Secret `FDC_SIGNING_KEY` 中，绝不提交。

在提交 `fdc-release.pub.pem` 并配置 Secret 之前，发布流程会直接失败，不会发布未签名的包。

生成与验签方法见仓库根目录 README 的「发布与验签」一节。
