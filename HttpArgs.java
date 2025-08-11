@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public static class HttpArgs {
    private String url;
    private String method;
    private Map<String, String> headers;
    private String body;
    private int bodyType;
}