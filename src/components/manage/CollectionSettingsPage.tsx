import React, { useState } from 'react';
import { 
  Container, 
  Text, 
  TextInput, 
  Switch, 
  PasswordInput, 
  Button, 
  Group,
  Card,
  Divider
} from '@mantine/core';
import { Link, useParams } from 'react-router-dom';

const CollectionSettingsPage: React.FC = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  
  const [collectionName, setCollectionName] = useState('My First Collection');
  const [isPublic, setIsPublic] = useState(false);
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Form submission logic would go here
    console.log('Settings saved:', { collectionName, isPublic, requirePassword, password });
  };

  const handleTogglePublic = () => {
    setIsPublic(!isPublic);
  };

  const handleTogglePassword = () => {
    setRequirePassword(!requirePassword);
  };

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
          
          <Group position="apart" mb="md">
            <Text>Make Collection Public</Text>
            <Switch 
              checked={isPublic} 
              onChange={handleTogglePublic}
              label="Visible to everyone"
            />
          </Group>
          
          {isPublic && (
            <Group position="apart" mb="md">
              <Text>Require Password for Access</Text>
              <Switch 
                checked={requirePassword} 
                onChange={handleTogglePassword}
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
          
          <Group position="center" mt="xl">
            <Button type="submit">Save Settings</Button>
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