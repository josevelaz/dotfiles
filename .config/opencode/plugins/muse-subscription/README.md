# Muse Subscription for OpenCode

This local OpenCode plugin uses Meta's device login and Model API directly. It does not execute or proxy the `muse` binary.

The login flow:

1. obtains a Meta device code;
2. exchanges the approved Meta account token for a subscription Model API key;
3. stores both in OpenCode's credential store;
4. sends model requests directly to `https://api.meta.ai/v1/responses` with the subscription key.

The provider is intentionally separate from OpenCode's built-in `meta` provider. Choose models under **Muse Subscription**, not **Meta**, to avoid using a separately configured pay-as-you-go Meta API key.

## Connect

Restart OpenCode so it loads the plugin, then run:

```text
/connect
# Muse Subscription → Meta account (Muse Code subscription)
```

Or from a terminal:

```bash
opencode auth login muse-subscription --method meta-account
```

After approving the browser code, select `muse-subscription/muse-spark-1.3` from `/models`.

The key exchange fails closed if Meta does not explicitly report an active subscription or reports that payment is required. Terms and billing-dashboard verification were deferred at the user's request; confirm the first request against your Meta subscription usage before sustained use.
