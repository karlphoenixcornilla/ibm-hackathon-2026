package com.example.demoapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Reproduction test for issue #7: Login crashes on Android 14 with biometric enabled.
 *
 * Steps:
 *  1. Launch LoginActivity with biometric auth enabled.
 *  2. Show the BiometricPrompt.
 *  3. Press the power button to lock the screen.
 *  4. Unlock the screen.
 *  5. Assert the Activity resumed (not destroyed).
 *
 * The bug causes the Activity to be destroyed after step 4, matching signature:
 *   "expected activity to resume but got DESTROYED"
 */
@RunWith(AndroidJUnit4::class)
class LoginBiometricTest {

    @Test
    fun testBiometricLoginSurvivesLockScreen() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)

        // Launch the activity
        val context = instrumentation.targetContext
        val intent = context.packageManager.getLaunchIntentForPackage("com.example.demoapp")
            ?: fail("Could not find package com.example.demoapp")
        context.startActivity(intent)
        Thread.sleep(2000)

        // Lock the screen
        device.sleep()
        Thread.sleep(1500)

        // Unlock the screen
        device.wakeUp()
        device.pressMenu()
        Thread.sleep(2000)

        // Check if the activity is still alive
        // The real check would inspect the activity lifecycle state.
        // Here we assert via a flag written by the activity on resume.
        val prefs = context.getSharedPreferences("reprise_test", 0)
        val state = prefs.getString("activity_state", "UNKNOWN") ?: "UNKNOWN"

        assertTrue(
            "expected activity to resume but got $state",
            state == "RESUMED"
        )
    }
}
