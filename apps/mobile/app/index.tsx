import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { Splash } from '../src/components/Splash';

/** Entry point: sends the user to the screen for their current auth state. */
export default function Index() {
  const { state, onboardingSeen } = useAuth();
  switch (state.status) {
    case 'signedOut':
      return <Redirect href={onboardingSeen ? '/sign-in' : '/onboarding'} />;
    case 'needsBusiness':
      return <Redirect href="/setup" />;
    case 'ready':
      return <Redirect href="/home" />;
    default:
      return <Splash />;
  }
}
