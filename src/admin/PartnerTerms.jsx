// NGS Partner — Terms & Conditions and Declaration of Authenticity.
// Shown full-screen when the partner taps the "Terms & Conditions" link during
// registration. Bump TERMS_VERSION whenever the wording materially changes so
// each partner's stored acceptance points at the exact text they agreed to.
export const TERMS_VERSION = "1.0";

const STORE = {
  brand: "NGS — Nisha General Store",
  address: "Sultanpur, New Delhi 110030",
};

export default function PartnerTerms({ onClose }) {
  return (
    <div className="terms-page">
      <header className="terms-bar">
        <button onClick={onClose} aria-label="Back">←</button>
        <span>Terms &amp; Conditions</span>
      </header>

      <div className="terms-body">
        <h1>NGS Partner — Terms &amp; Conditions and Declaration of Authenticity</h1>
        <p className="terms-meta">{STORE.brand}, {STORE.address} · Version {TERMS_VERSION}</p>

        <p>
          These Terms &amp; Conditions ("Terms") govern your registration and
          engagement as a picking and/or delivery partner ("Partner") with
          {" "}{STORE.brand} ("NGS", "we", "us"). By ticking the acceptance
          boxes and submitting your registration, you confirm that you have read,
          understood and agreed to these Terms, and you make the declarations
          below. Acceptance made electronically is valid and binding under
          Section 10A of the Information Technology Act, 2000.
        </p>

        <h2>1. Declaration of authenticity</h2>
        <p>
          I solemnly declare that all information I have provided — including my
          name, address, mobile number, bank details, and the identity documents
          I upload (Aadhaar card front and back, PAN card, and driving licence,
          where applicable), together with the document numbers I enter — are
          <strong> true, genuine, valid, unaltered, and belong to me.</strong> I
          confirm that none of the documents or details are forged, fabricated,
          tampered, borrowed, or belonging to any other person.
        </p>

        <h2>2. Consent to verification</h2>
        <p>
          I authorise NGS to verify, at any time, the authenticity and validity
          of the documents and details I have submitted, whether directly, or
          through authorised third-party verification services, or with the
          issuing government authorities. I consent to my documents being stored
          securely and used solely for onboarding, verification, payment and
          legal-compliance purposes.
        </p>

        <h2>3. Consequences of false, forged or tampered documents</h2>
        <p>
          I understand and accept that submitting any false, forged, fabricated
          or tampered document or information is a <strong>serious punishable
          offence under the laws of India.</strong> Such acts may attract
          criminal and civil liability, including but not limited to:
        </p>
        <ul>
          <li>
            <strong>Forgery and cheating</strong> under the Bharatiya Nyaya
            Sanhita, 2023 (including Sections 318 and 319 relating to cheating and
            cheating by personation, and Sections 335, 336 and 340 relating to
            making and using forged documents), corresponding to the earlier
            provisions of the Indian Penal Code, 1860.
          </li>
          <li>
            <strong>Impersonation and false information</strong> under Section 34
            of the Aadhaar (Targeted Delivery of Financial and Other Subsidies,
            Benefits and Services) Act, 2016.
          </li>
          <li>
            <strong>Identity theft and cheating by personation</strong> using a
            computer resource under Sections 66C and 66D of the Information
            Technology Act, 2000.
          </li>
        </ul>
        <p>
          I understand these offences may be punishable with imprisonment and/or
          fine as prescribed under the respective laws.
        </p>

        <h2>4. Action NGS may take</h2>
        <p>If any document or detail is found to be false, forged or tampered, NGS may, at its sole discretion and without prior notice:</p>
        <ul>
          <li>reject my registration or immediately terminate my engagement;</li>
          <li>withhold any pending payments or dues to the extent permitted by law;</li>
          <li>report the matter to the police and the relevant authorities and file a criminal complaint; and</li>
          <li>recover any loss, damage or expense caused to NGS.</li>
        </ul>

        <h2>5. Liability and indemnity</h2>
        <p>
          I accept full and sole responsibility for the correctness and
          genuineness of everything I submit. I agree to indemnify and hold NGS,
          its owner and staff harmless against any loss, damage, claim, penalty
          or legal proceeding arising out of any false, forged, tampered or
          misleading information or document provided by me. NGS shall not be
          liable for any consequence arising from my furnishing of incorrect or
          fraudulent details.
        </p>

        <h2>6. Conduct and honesty</h2>
        <p>
          I agree to carry out my duties honestly and lawfully, to safeguard
          customer orders, cash and goods entrusted to me, and to promptly inform
          NGS of any change in my details or documents.
        </p>

        <h2>7. Data protection</h2>
        <p>
          My documents and personal data are stored securely with restricted
          access and are handled in accordance with applicable Indian law,
          including the Digital Personal Data Protection Act, 2023. They will be
          retained only for as long as necessary for the purposes stated above or
          as required by law.
        </p>

        <h2>8. Governing law and jurisdiction</h2>
        <p>
          These Terms are governed by the laws of India. The courts at Delhi
          shall have jurisdiction over any dispute arising out of or relating to
          these Terms.
        </p>

        <p className="terms-ack">
          By ticking the acceptance boxes in the registration form, I confirm
          that the above declaration is true and that I accept these Terms in
          full, of my own free will.
        </p>
      </div>
    </div>
  );
}
