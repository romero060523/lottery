import FaqSection from '../components/landing/FaqSection'
import FechasSorteoSection from '../components/landing/FechasSorteoSection'
import GanadoresSection from '../components/landing/GanadoresSection'
import HeroSection from '../components/landing/HeroSection'
import MecanicaSection from '../components/landing/MecanicaSection'
import PremiosSection from '../components/landing/PremiosSection'
import TicketsSection from '../components/landing/TicketsSection'
import TransparenciaSection from '../components/landing/TransparenciaSection'

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <FechasSorteoSection />
      <PremiosSection />
      <MecanicaSection />
      <TicketsSection />
      <TransparenciaSection />
      <GanadoresSection />
      <FaqSection />
    </>
  )
}
