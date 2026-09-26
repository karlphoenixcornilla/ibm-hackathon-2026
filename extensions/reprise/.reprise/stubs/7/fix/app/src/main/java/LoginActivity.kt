package com.example.demoapp

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * LoginActivity — handles biometric authentication.
 *
 * FIX for issue #7: Added isFinishing()/isDestroyed() guards in every
 * BiometricPrompt callback method to prevent IllegalStateException when
 * the system destroys the Activity while the prompt is displayed.
 */
class LoginActivity : FragmentActivity() {

    private lateinit var biometricPrompt: BiometricPrompt
    private lateinit var promptInfo: BiometricPrompt.PromptInfo

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        setupBiometricAuth()
    }

    override fun onResume() {
        super.onResume()
        // Write state for instrumentation test
        getSharedPreferences("reprise_test", MODE_PRIVATE)
            .edit().putString("activity_state", "RESUMED").apply()
    }

    private fun setupBiometricAuth() {
        val executor = ContextCompat.getMainExecutor(this)
        biometricPrompt = BiometricPrompt(this, executor,
            object : BiometricPrompt.AuthenticationCallback() {

                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    // FIX: guard against destroyed Activity
                    if (isFinishing || isDestroyed) return
                    navigateToHome()
                }

                override fun onAuthenticationFailed() {
                    super.onAuthenticationFailed()
                    // FIX: guard against destroyed Activity
                    if (isFinishing || isDestroyed) return
                    Toast.makeText(
                        applicationContext,
                        "Authentication failed. Please try again.",
                        Toast.LENGTH_SHORT
                    ).show()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    // FIX: guard against destroyed Activity
                    if (isFinishing || isDestroyed) return
                    Toast.makeText(
                        applicationContext,
                        "Authentication error: $errString",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        )

        promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Biometric login")
            .setSubtitle("Log in using your biometric credential")
            .setNegativeButtonText("Use account password")
            .build()

        // Show the prompt
        biometricPrompt.authenticate(promptInfo)
    }

    private fun navigateToHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }
}
