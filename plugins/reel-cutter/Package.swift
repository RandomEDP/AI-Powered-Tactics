// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ReelCutter",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "ReelCutter", targets: ["ReelCutterPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/microsoft/onnxruntime-swift-package-manager.git", from: "1.19.0")
    ],
    targets: [
        .target(
            name: "ReelCutterPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "onnxruntime", package: "onnxruntime-swift-package-manager")
            ],
            path: "ios/Sources/ReelCutterPlugin",
            resources: [.copy("Resources/yolox_s.onnx")])
    ]
)
