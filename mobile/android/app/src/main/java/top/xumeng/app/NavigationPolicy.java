package top.xumeng.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

/** URL and download metadata validation shared by the Android shell and JVM tests. */
public final class NavigationPolicy {
    private static final int MAX_FILE_NAME_LENGTH = 120;
    // Android file systems commonly cap a path component at 255 UTF-8 bytes.
    private static final int MAX_FILE_NAME_BYTES = 240;
    private static final String DEFAULT_MIME_TYPE = "application/octet-stream";
    private static final Pattern MIME_TYPE = Pattern.compile(
            "[A-Za-z0-9!#$%&'+.^_`|~-]+/[A-Za-z0-9!#$%&'+.^_`|~-]+");

    private NavigationPolicy() {
    }

    /**
     * Matches an absolute URL against a configured, bare origin. Production origins
     * must use HTTPS on port 443. HTTP is reserved for explicitly configured local
     * development origins; their host and effective port must match exactly.
     */
    public static boolean isTrusted(String url, String origin) {
        URI candidate = webUri(url);
        URI configuredOrigin = webUri(origin);
        if (candidate == null || configuredOrigin == null || !isBareOrigin(configuredOrigin)) {
            return false;
        }

        String scheme = configuredOrigin.getScheme().toLowerCase(Locale.ROOT);
        String host = configuredOrigin.getHost().toLowerCase(Locale.ROOT);
        if ("https".equals(scheme)) {
            if (!isDefaultHttpsPort(configuredOrigin) || !isDefaultHttpsPort(candidate)) {
                return false;
            }
        } else if (!"http".equals(scheme) || !isDevelopmentHost(host)) {
            return false;
        }

        return scheme.equalsIgnoreCase(candidate.getScheme())
                && host.equalsIgnoreCase(candidate.getHost())
                && effectivePort(configuredOrigin) == effectivePort(candidate);
    }

    /** Only well-formed web URLs and the two supported external app schemes may leave the shell. */
    public static boolean isSafeExternal(String url) {
        URI candidate = parseUri(url);
        if (candidate == null || !candidate.isAbsolute()) {
            return false;
        }
        String scheme = candidate.getScheme().toLowerCase(Locale.ROOT);
        if ("https".equals(scheme) || "http".equals(scheme)) {
            return webUri(url) != null;
        }
        if (!"mailto".equals(scheme) && !"tel".equals(scheme)) {
            return false;
        }
        String destination = candidate.getRawSchemeSpecificPart();
        return candidate.isOpaque() && destination != null && !destination.isEmpty()
                && !destination.startsWith("//") && candidate.getRawFragment() == null;
    }

    /** Blob downloads are accepted only when the embedded creator origin is trusted. */
    public static boolean isTrustedBlob(String url, String origin) {
        URI candidate = parseUri(url);
        return candidate != null && "blob".equalsIgnoreCase(candidate.getScheme())
                && isTrusted(candidate.getRawSchemeSpecificPart(), origin);
    }

    /** Returns a single, bounded file name; no caller-controlled directory survives. */
    public static String safeFileName(String suggested, String fallback) {
        String name = cleanFileName(suggested);
        if (name.isEmpty()) {
            name = cleanFileName(fallback);
        }
        if (name.isEmpty()) {
            name = "download";
        }
        if (name.length() <= MAX_FILE_NAME_LENGTH && utf8Length(name) <= MAX_FILE_NAME_BYTES) {
            return name;
        }

        int extensionStart = name.lastIndexOf('.');
        if (extensionStart > 0 && extensionStart < name.length() - 1) {
            String extension = name.substring(extensionStart);
            int extensionBytes = utf8Length(extension);
            if (extension.length() < MAX_FILE_NAME_LENGTH && extensionBytes < MAX_FILE_NAME_BYTES) {
                return truncate(name.substring(0, extensionStart),
                        MAX_FILE_NAME_LENGTH - extension.length(), MAX_FILE_NAME_BYTES - extensionBytes) + extension;
            }
        }
        return truncate(name, MAX_FILE_NAME_LENGTH, MAX_FILE_NAME_BYTES);
    }

    /** Accepts a concrete MIME type, without parameters, wildcards, or header text. */
    public static String safeMimeType(String input) {
        if (input == null || hasControlCharacter(input)) {
            return DEFAULT_MIME_TYPE;
        }
        String mimeType = input.trim().toLowerCase(Locale.ROOT);
        return MIME_TYPE.matcher(mimeType).matches() ? mimeType : DEFAULT_MIME_TYPE;
    }

    private static URI parseUri(String value) {
        if (value == null || value.isEmpty() || hasControlCharacter(value)) {
            return null;
        }
        try {
            return new URI(value);
        } catch (URISyntaxException ignored) {
            return null;
        }
    }

    private static URI webUri(String value) {
        URI uri = parseUri(value);
        if (uri == null || !uri.isAbsolute() || uri.isOpaque()
                || !("https".equalsIgnoreCase(uri.getScheme())
                || "http".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null || uri.getHost().isEmpty()
                || uri.getHost().endsWith(".") || uri.getRawUserInfo() != null
                || uri.getRawAuthority() == null || uri.getRawAuthority().endsWith(":")) {
            return null;
        }
        int port = uri.getPort();
        return port == -1 || (port >= 1 && port <= 65535) ? uri : null;
    }

    private static boolean isBareOrigin(URI uri) {
        String path = uri.getRawPath();
        return (path == null || path.isEmpty() || "/".equals(path))
                && uri.getRawQuery() == null && uri.getRawFragment() == null;
    }

    private static boolean isDefaultHttpsPort(URI uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private static boolean isDevelopmentHost(String host) {
        return "localhost".equals(host) || "127.0.0.1".equals(host) || "10.0.2.2".equals(host);
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() != -1) {
            return uri.getPort();
        }
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static String cleanFileName(String input) {
        if (input == null) {
            return "";
        }
        String normalized = input.replace('\\', '/');
        String basename = normalized.substring(normalized.lastIndexOf('/') + 1);
        StringBuilder cleaned = new StringBuilder(basename.length());
        for (int index = 0; index < basename.length(); ) {
            int character = basename.codePointAt(index);
            index += Character.charCount(character);
            if (Character.isISOControl(character) || Character.getType(character) == Character.FORMAT) {
                continue;
            }
            if (character == '<' || character == '>' || character == ':' || character == '"'
                    || character == '|' || character == '?' || character == '*') {
                cleaned.append('_');
            } else {
                cleaned.appendCodePoint(character);
            }
        }
        String name = cleaned.toString().trim();
        return name.equals(".") || name.equals("..") ? "" : name;
    }

    private static String truncate(String input, int maxLength, int maxBytes) {
        int end = 0;
        int bytes = 0;
        while (end < input.length()) {
            int character = input.codePointAt(end);
            int next = end + Character.charCount(character);
            int encodedBytes = character <= 0x7f ? 1 : character <= 0x7ff ? 2
                    : character <= 0xffff ? 3 : 4;
            if (next > maxLength || bytes + encodedBytes > maxBytes) {
                break;
            }
            bytes += encodedBytes;
            end = next;
        }
        return input.substring(0, end);
    }

    private static int utf8Length(String input) {
        return input.getBytes(StandardCharsets.UTF_8).length;
    }

    private static boolean hasControlCharacter(String input) {
        for (int index = 0; index < input.length(); index++) {
            if (Character.isISOControl(input.charAt(index))) {
                return true;
            }
        }
        return false;
    }
}
