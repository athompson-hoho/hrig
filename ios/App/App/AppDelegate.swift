import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
// hRig's local plugin keeps credentials out of web storage and pins host TLS.
import Security
import CryptoKit

class HrigViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HrigLinkPlugin())
    }
}

private class HrigPinnedSession: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    let fingerprint: String
    init(_ fingerprint: String) { self.fingerprint = fingerprint }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let cert = SecTrustGetCertificateAtIndex(trust, 0) else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        let data = SecCertificateCopyData(cert) as Data
        let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard actual == fingerprint else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        // Only the certificate conveyed by the physical desktop invitation is trusted.
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@objc(HrigLinkPlugin)
public class HrigLinkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HrigLinkPlugin"
    public let jsName = "HrigLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "dev.hrig.companion.devices", kSecAttrAccount as String: "profiles"] }
    @objc func load(_ call: CAPPluginCall) {
        var options = query
        options[kSecReturnData as String] = true
        options[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(options as CFDictionary, &item)
        if status == errSecItemNotFound { call.resolve(["value": "[]"]); return }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else { call.reject("Could not unlock saved hRig devices."); return }
        call.resolve(["value": value])
    }
    @objc func save(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), value.utf8.count <= 65536 else { call.reject("Invalid saved computer profiles."); return }
        let data = Data(value.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { call.reject("Could not save hRig devices securely."); return }
        } else if status != errSecSuccess { call.reject("Could not update hRig device storage."); return }
        call.resolve()
    }
    @objc func request(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"), let url = URL(string: rawURL), url.scheme == "https", url.path == "/api", url.user == nil, url.query == nil,
              let pin = call.getString("fingerprint"), pin.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              let body = call.getObject("data"), let encoded = try? JSONSerialization.data(withJSONObject: body), encoded.count <= 65536 else { call.reject("Invalid pinned host request."); return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"; request.httpBody = encoded; request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let credential = call.getString("credential") { request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization") }
        if call.getBool("pairing") == true { request.setValue("1", forHTTPHeaderField: "X-Hrig-Pairing") }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForResource = 65
        let session = URLSession(configuration: config, delegate: HrigPinnedSession(pin), delegateQueue: nil)
        session.dataTask(with: request) { data, response, error in
            defer { session.finishTasksAndInvalidate() }
            guard error == nil, let data = data, data.count <= 1048576,
                  let response = response as? HTTPURLResponse,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { call.reject("Could not reach the approved hRig host. Check network, firewall, and TLS identity."); return }
            call.resolve(["status": response.statusCode, "data": json])
        }.resume()
    }
}
