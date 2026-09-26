import React, { useState, useEffect } from 'react';
import {
  Container,
  Text,
  TextInput,
  Switch,
  PasswordInput,
  Button,
  Group,
  Card,
  Divider,
  Alert,
  Loader
} from '@mantine/core';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { collectionService } from '../../services/collectionService';

const CollectionSettingsPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();

  const [collectionName, setCollectionName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState('');

  // The actual Firestore document id. The route param can be formatted as
  // "{urlized-name}-{id}", so we capture the real id from the fetch and use
  // it (rather than the raw param) when updating the document.
  const [docId, setDocId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!collectionId) {
      setError('Invalid collection id');
      setLoading(false);
      return;
    }

    const fetchCollection = async () => {
      try {
        const collectionData = await collectionService.getCollection(collectionId);
        if (!collectionData) {
          setError('Collection not found');
        } else {
          setCollectionName(collectionData.name ?? '');
          setIsPublic(Boolean(collectionData.isPublic));
          setDocId(collectionData.id);
        }
      } catch (err) {
        console.error('Error fetching collection:', err);
        setError('Failed to load collection settings. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchCollection();
  }, [collectionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Fall back to the raw route param if we never captured the real id.
    const targetId = docId ?? collectionId;
    if (!targetId) {
      setError('Invalid collection id');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await collectionService.updateCollection(targetId, {
        name: collectionName.trim(),
        isPublic,
      });
      navigate(`/manage/collection/${collectionId}`);
    } catch (err) {
      console.error('Error updating collection:', err);
      setError('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
       <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
         <Loader />
       </Container>
      );
   }

  if (error) {
    return (
       <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
         <Alert color="red">{error}</Alert>
       </Container>
      );
   }

  return (
     <Container size="sm" style={{ paddingTop: '2rem', paddingBottom: '2rem' }}>
      <Text size="h2" mb="xl">Collection Settings</Text>

      <Card shadow="sm" p="lg">
        <form onSubmit={handleSubmit}>
          <TextInput
            label="Collection Name"
            placeholder="Name of your collection"
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            required
            mb="md"
          />

          <Divider mt="md" mb="md" />

          <Text size="h3" mb="md">Privacy Settings</Text>

          <Group justify="space-between" mb="md">
            <Text>Make Collection Public</Text>
            <Switch
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              label="Visible to everyone"
            />
          </Group>

          {isPublic && (
            <Group justify="space-between" mb="md">
              <Text>Require Password for Access</Text>
              <Switch
                checked={requirePassword}
                onChange={(e) => setRequirePassword(e.target.checked)}
                label="Password protected"
              />
            </Group>
          )}

          {requirePassword && (
            <PasswordInput
              label="Password"
              placeholder="Enter password to protect collection"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              mb="md"
            />
          )}

          <Group justify="center" mt="xl">
            <Button type="submit" loading={saving}>
              Save Settings
            </Button>
            <Button component={Link} to={`/manage/collection/${collectionId}`} variant="outline">
              Cancel
            </Button>
          </Group>
        </form>
      </Card>
    </Container>
   );
};

export default CollectionSettingsPage;