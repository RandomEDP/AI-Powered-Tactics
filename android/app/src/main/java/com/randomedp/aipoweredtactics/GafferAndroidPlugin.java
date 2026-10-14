package com.randomedp.aipoweredtactics;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The app's own small plugin. pushReady says whether this build has the team's Firebase file in it (the google-services
// Gradle plugin turns that file into a "google_app_id" resource). Without it Android can't have notifications, and
// asking Firebase for the phone's address would crash the app, so the web app checks here first.
@CapacitorPlugin(name = "GafferAndroid")
public class GafferAndroidPlugin extends Plugin {

    @PluginMethod
    public void pushReady(PluginCall call) {
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject out = new JSObject();
        out.put("ready", id != 0);
        call.resolve(out);
    }
}
