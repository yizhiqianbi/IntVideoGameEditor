package top.xumeng.app;

import java.nio.charset.StandardCharsets;

/** Run with javac/java; this suite intentionally has no Android or test-library dependency. */
public final class NavigationPolicyTest {
    private static final String ORIGIN = "https://xumengchat.top";
    private static int checks;

    public static void main(String[] args) {
        trustedOriginChecks();
        developmentOriginChecks();
        externalUrlChecks();
        blobChecks();
        fileNameChecks();
        mimeTypeChecks();
        System.out.println("NavigationPolicy: " + checks + " checks passed");
    }

    private static void trustedOriginChecks() {
        trusted(ORIGIN, ORIGIN, true);
        trusted("https://xumengchat.top/chat?id=2#reply", ORIGIN + "/", true);
        trusted("HTTPS://XUMENGCHAT.TOP:443/chat", ORIGIN, true);
        trusted(ORIGIN + "/@evil.example/../account", ORIGIN, true);
        trusted(ORIGIN, ORIGIN + ":443/", true);
        trusted(null, ORIGIN, false);
        trusted(ORIGIN, null, false);
        trusted("", ORIGIN, false);
        trusted("/chat", ORIGIN, false);
        trusted("//xumengchat.top/chat", ORIGIN, false);
        trusted("http://xumengchat.top/chat", ORIGIN, false);
        trusted("https://xumengchat.top.evil.example/chat", ORIGIN, false);
        trusted("https://evil-xumengchat.top/chat", ORIGIN, false);
        trusted("https://evil.example/xumengchat.top", ORIGIN, false);
        trusted("https://xumengchat.top@evil.example/chat", ORIGIN, false);
        trusted("https://evil.example@xumengchat.top/chat", ORIGIN, false);
        trusted("https://@xumengchat.top/chat", ORIGIN, false);
        trusted("https://xumengchat.top:8443/chat", ORIGIN, false);
        trusted("https://xumengchat.top:0/chat", ORIGIN, false);
        trusted("https://xumengchat.top:65536/chat", ORIGIN, false);
        trusted("https://xumengchat.top:/chat", ORIGIN, false);
        trusted("https://xumengchat.top./chat", ORIGIN, false);
        trusted("https://%78umengchat.top/chat", ORIGIN, false);
        trusted("https://xumengchat.top%2eevil.example/chat", ORIGIN, false);
        trusted("https://xumengchat.top\\@evil.example/chat", ORIGIN, false);
        trusted("https://xumengchat.top\n.evil.example/chat", ORIGIN, false);
        trusted(" https://xumengchat.top", ORIGIN, false);
        trusted("javascript:alert(1)", ORIGIN, false);
        trusted("file:///xumengchat.top", ORIGIN, false);
        trusted(ORIGIN, ORIGIN + "/chat", false);
        trusted(ORIGIN, ORIGIN + "/%2e", false);
        trusted(ORIGIN, ORIGIN + "?next=evil", false);
        trusted(ORIGIN, ORIGIN + "#fragment", false);
        trusted(ORIGIN, "https://user@xumengchat.top", false);
        trusted("https://xumengchat.top:8443", "https://xumengchat.top:8443", false);
    }

    private static void developmentOriginChecks() {
        trusted("http://localhost:3000/chat", "http://localhost:3000", true);
        trusted("http://LOCALHOST:3000/chat", "http://localhost:3000/", true);
        trusted("http://127.0.0.1:3000/chat", "http://127.0.0.1:3000", true);
        trusted("http://10.0.2.2:3000/chat", "http://10.0.2.2:3000", true);
        trusted("http://localhost:80/chat", "http://localhost", true);
        trusted("http://localhost:3001/chat", "http://localhost:3000", false);
        trusted("http://127.0.0.1:3000/chat", "http://localhost:3000", false);
        trusted("http://localhost.evil.example:3000/chat", "http://localhost:3000", false);
        trusted("http://localhost:3000", ORIGIN, false);
        trusted("http://192.168.1.2:3000/chat", "http://192.168.1.2:3000", false);
        trusted("http://127.1:3000/chat", "http://127.1:3000", false);
        trusted("http://[::1]:3000/chat", "http://[::1]:3000", false);
        trusted("https://localhost:443/chat", "http://localhost", false);
        trusted("http://localhost:3000/chat", "http://localhost:3000/chat", false);
    }

    private static void externalUrlChecks() {
        external("https://example.com/path?x=1#y", true);
        external("http://example.com:8080/path", true);
        external("mailto:hello@example.com?subject=Hello", true);
        external("tel:+86-123-456", true);
        external("MAILTO:hello@example.com", true);
        external("https://example.com:65535", true);
        external("https://example.com:65536", false);
        external("https://example.com:0", false);
        external("https://example.com:", false);
        external("https://name@example.com", false);
        external("https://%65xample.com", false);
        external("https:///example.com", false);
        external("https://example.com\r\nInjected: yes", false);
        external("intent://example.com#Intent;scheme=https;end", false);
        external("javascript:alert(1)", false);
        external("content://top.xumeng.app/private", false);
        external("file:///sdcard/private", false);
        external("data:text/html,hello", false);
        external("blob:https://xumengchat.top/id", false);
        external("ftp://example.com/file", false);
        external("/account", false);
        external("mailto:", false);
        external("tel:", false);
        external("tel://evil.example/path", false);
        external("mailto://evil.example/path", false);
        external(null, false);
    }

    private static void blobChecks() {
        blob("blob:https://xumengchat.top/1234", ORIGIN, true);
        blob("blob:https://XUMENGCHAT.TOP:443/1234", ORIGIN, true);
        blob("blob:https://xumengchat.top/1234#download", ORIGIN, true);
        blob("blob:http://localhost:3000/1234", "http://localhost:3000", true);
        blob("blob:https://evil.example/1234", ORIGIN, false);
        blob("blob:https://xumengchat.top.evil.example/1234", ORIGIN, false);
        blob("blob:https://evil@xumengchat.top/1234", ORIGIN, false);
        blob("blob:https://xumengchat.top:8443/1234", ORIGIN, false);
        blob("blob:https://%78umengchat.top/1234", ORIGIN, false);
        blob("blob:http://xumengchat.top/1234", ORIGIN, false);
        blob("blob:null/1234", ORIGIN, false);
        blob("blob:blob:https://xumengchat.top/1234", ORIGIN, false);
        blob("https://xumengchat.top/1234", ORIGIN, false);
        blob(null, ORIGIN, false);
    }

    private static void fileNameChecks() {
        equal("character.json", NavigationPolicy.safeFileName("../../character.json", "export.json"));
        equal("character.json", NavigationPolicy.safeFileName("C:\\users\\secret\\character.json", "export.json"));
        equal("character.json", NavigationPolicy.safeFileName("/data/private/character.json", "export.json"));
        equal("character.json", NavigationPolicy.safeFileName("char\u0000acter\n.json", "export.json"));
        equal("safe_gpj.json", NavigationPolicy.safeFileName("safe_\u202egpj.json", "export.json"));
        equal("a_b_c_.json", NavigationPolicy.safeFileName("a:b?c*.json", "export.json"));
        equal("export.json", NavigationPolicy.safeFileName("..", "../export.json"));
        equal("export.json", NavigationPolicy.safeFileName("../../", "export.json"));
        equal("download", NavigationPolicy.safeFileName(null, ".."));
        equal("download", NavigationPolicy.safeFileName("\u0000", null));
        equal(".character", NavigationPolicy.safeFileName(".character", "export.json"));
        equal("角色卡.json", NavigationPolicy.safeFileName("  角色卡.json  ", "export.json"));
        String longName = repeat("a", 200) + ".json";
        String bounded = NavigationPolicy.safeFileName(longName, "export.json");
        check(bounded.length() == 120 && bounded.endsWith(".json"), "long names retain their extension");
        String unicode = NavigationPolicy.safeFileName(repeat("a", 114) + "😀😀.json", "export.json");
        check(unicode.length() <= 120 && unicode.endsWith(".json"), "Unicode names stay bounded");
        check(!hasUnpairedSurrogate(unicode), "name truncation never splits a surrogate pair");
        String chinese = NavigationPolicy.safeFileName(repeat("梦", 120) + ".json", "export.json");
        check(chinese.getBytes(StandardCharsets.UTF_8).length <= 240 && chinese.endsWith(".json"),
                "Chinese file names also fit a filesystem component's byte limit");
        equal("%2e%2e.json", NavigationPolicy.safeFileName("../%2e%2e.json", "export.json"));
    }

    private static void mimeTypeChecks() {
        equal("application/json", NavigationPolicy.safeMimeType("application/json"));
        equal("image/png", NavigationPolicy.safeMimeType(" IMAGE/PNG "));
        equal("application/vnd.xumeng+json", NavigationPolicy.safeMimeType("application/vnd.xumeng+json"));
        for (String invalid : new String[]{null, "", "text/plain; charset=UTF-8", "text", "text//plain",
                "text /plain", "text/", "*/json", "image/*", "application/json\r\nX-Header: secret",
                "application/json\n", "application/json, text/plain", "text/plain<svg>"}) {
            equal("application/octet-stream", NavigationPolicy.safeMimeType(invalid));
        }
    }

    private static void trusted(String url, String origin, boolean expected) {
        check(NavigationPolicy.isTrusted(url, origin) == expected, "trusted URL: " + url + "; origin: " + origin);
    }

    private static void external(String url, boolean expected) {
        check(NavigationPolicy.isSafeExternal(url) == expected, "external URL: " + url);
    }

    private static void blob(String url, String origin, boolean expected) {
        check(NavigationPolicy.isTrustedBlob(url, origin) == expected, "blob URL: " + url);
    }

    private static void equal(String expected, String actual) {
        check(expected.equals(actual), "expected '" + expected + "', got '" + actual + "'");
    }

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private static String repeat(String value, int count) {
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < count; index++) {
            result.append(value);
        }
        return result.toString();
    }

    private static boolean hasUnpairedSurrogate(String value) {
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (Character.isHighSurrogate(current)) {
                if (++index >= value.length() || !Character.isLowSurrogate(value.charAt(index))) {
                    return true;
                }
            } else if (Character.isLowSurrogate(current)) {
                return true;
            }
        }
        return false;
    }
}
