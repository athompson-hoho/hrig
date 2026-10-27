package dev.hrig.companion;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

@CapacitorPlugin(name = "HrigLink")
public class HrigLinkPlugin extends Plugin {
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private SecretKey vaultKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias("hrig-devices")) return (SecretKey) store.getKey("hrig-devices", null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder("hrig-devices", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    @PluginMethod public synchronized void load(PluginCall call) {
        try {
            String saved = getContext().getSharedPreferences("hrig-vault", 0).getString("profiles", null);
            String value = "[]";
            if (saved != null) {
                String[] pieces = saved.split(":", 2);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, vaultKey(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
                value = new String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
            }
            JSObject result = new JSObject(); result.put("value", value); call.resolve(result);
        } catch (Exception e) { call.reject("Could not unlock saved hRig devices. " + e.getMessage()); }
    }
    @PluginMethod public synchronized void save(PluginCall call) {
        try {
            String value = call.getString("value", "[]");
            if (value.length() > 65536) throw new Exception("Too many saved computers.");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, vaultKey());
            String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!getContext().getSharedPreferences("hrig-vault", 0).edit().putString("profiles", encoded).commit()) throw new Exception("Storage write failed.");
            call.resolve();
        } catch (Exception e) { call.reject("Could not save hRig device securely. " + e.getMessage()); }
    }
    @PluginMethod public void request(PluginCall call) {
        executor.execute(() -> {
            HttpsURLConnection connection = null;
            try {
                URL url = new URL(call.getString("url", ""));
                String pin = call.getString("fingerprint", "").toLowerCase();
                if (!url.getProtocol().equals("https") || !url.getPath().equals("/api") || url.getUserInfo() != null || url.getQuery() != null || !pin.matches("[a-f0-9]{64}")) throw new Exception("Invalid pinned host address.");
                TrustManager[] trust = new TrustManager[]{new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    public void checkClientTrusted(X509Certificate[] chain, String type) throws CertificateException { throw new CertificateException("Client trust not supported."); }
                    public void checkServerTrusted(X509Certificate[] chain, String type) throws CertificateException {
                        try {
                            chain[0].checkValidity();
                            byte[] digest = MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded());
                            StringBuilder hex = new StringBuilder(); for (byte b : digest) hex.append(String.format("%02x", b));
                            if (!MessageDigest.isEqual(hex.toString().getBytes(StandardCharsets.US_ASCII), pin.getBytes(StandardCharsets.US_ASCII))) throw new CertificateException("Host identity changed. Pair again from the desktop.");
                        } catch (Exception e) { throw new CertificateException("hRig TLS identity rejected.", e); }
                    }
                }};
                SSLContext tls = SSLContext.getInstance("TLS"); tls.init(null, trust, null);
                connection = (HttpsURLConnection) url.openConnection();
                connection.setSSLSocketFactory(tls.getSocketFactory());
                // Host identity is the QR-pinned certificate, independent of LAN/VPN IP.
                connection.setHostnameVerifier((hostname, session) -> true);
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(6000); connection.setReadTimeout(60000);
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                String credential = call.getString("credential");
                if (credential != null) connection.setRequestProperty("Authorization", "Bearer " + credential);
                if (call.getBoolean("pairing", false)) connection.setRequestProperty("X-Hrig-Pairing", "1");
                byte[] body = call.getObject("data", new JSObject()).toString().getBytes(StandardCharsets.UTF_8);
                if (body.length > 65536) throw new Exception("Request is too large.");
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
                int status = connection.getResponseCode();
                try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
                    if (input != null) while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); if (output.size() > 1048576) throw new Exception("Host response is too large."); }
                    JSObject result = new JSObject(); result.put("status", status); result.put("data", new JSObject(output.toString("UTF-8"))); call.resolve(result);
                }
            } catch (Exception e) { call.reject("Could not reach the approved hRig host. Check network, firewall, and TLS identity. " + e.getMessage()); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    @Override protected void handleOnDestroy() { executor.shutdownNow(); }
}
