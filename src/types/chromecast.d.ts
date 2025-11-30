declare namespace chrome.cast {
  export enum ReceiverAvailability {
    AVAILABLE = 'available',
    UNAVAILABLE = 'unavailable',
  }

  export class Error {
    code: string;
    description: string;
    details: any;
  }

  export class SessionRequest {
    constructor(appId: string);
  }

  export class ApiConfig {
    constructor(
      sessionRequest: SessionRequest,
      sessionListener: (session: Session) => void,
      receiverListener: (availability: ReceiverAvailability) => void,
      autoJoinPolicy?: string,
      defaultActionPolicy?: string
    );
  }

  export class Session {
    receiver: {
      friendlyName: string;
      id?: string;
    };
    addUpdateListener(listener: (isAlive: boolean) => void): void;
    loadMedia(
      loadRequest: media.LoadRequest,
      successCallback: (media: media.Media) => void,
      errorCallback: (error: Error) => void
    ): void;
    stop(
      successCallback: () => void,
      errorCallback: (error: Error) => void
    ): void;
  }

  export function initialize(
    apiConfig: ApiConfig,
    successCallback: () => void,
    errorCallback: (error: Error) => void
  ): void;

  export function requestSession(
    successCallback: (session: Session) => void,
    errorCallback: (error: Error) => void
  ): void;

  export namespace media {
    export const DEFAULT_MEDIA_RECEIVER_APP_ID: string;

    export class MediaInfo {
      constructor(contentId: string, contentType: string);
      metadata: any;
    }

    export class GenericMediaMetadata {
      title?: string;
      subtitle?: string;
      images?: any[];
    }

    export class LoadRequest {
      constructor(mediaInfo: MediaInfo);
    }

    export class Media {
      mediaInfo: MediaInfo;
    }
  }
}
